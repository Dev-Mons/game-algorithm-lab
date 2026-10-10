#pragma once

#include "SkillTreeTypes.h"

// Native C++ reference for the web editor's src/rules.ts and src/effects.ts. No JS runtime is required.
// Ranks keys are node Row Names (DT_<TreeId>_Nodes), never SkillId. The game owns the Ranks map,
// available points and saving; these functions only answer rule questions and never mutate state.
namespace SkillTreeRules
{
    enum class EInvestResult : uint8
    {
        Ok,
        UnknownNode,
        MaxRankReached,
        PrerequisitesNotMet,
        TreePointsNotMet,
        NotEnoughPoints
    };

    struct FTree
    {
        const UDataTable* Skills = nullptr;
        const UDataTable* Nodes = nullptr;

        bool IsValid() const
        {
            return Skills && Nodes && Skills->GetRowStruct() && Nodes->GetRowStruct()
                && Skills->GetRowStruct()->IsChildOf(FSkillDefinitionRow::StaticStruct())
                && Nodes->GetRowStruct()->IsChildOf(FSkillTreeNodeRow::StaticStruct());
        }
        const FSkillTreeNodeRow* Node(FName NodeId) const
        {
            return Nodes->FindRow<FSkillTreeNodeRow>(NodeId, TEXT("SkillTreeRules"), false);
        }
        const FSkillDefinitionRow* Skill(const FSkillTreeNodeRow& Node) const
        {
            return Skills->FindRow<FSkillDefinitionRow>(Node.SkillId, TEXT("SkillTreeRules"), false);
        }
        // Ordinal Row Name order, matching the editor's summation order.
        TArray<FName> SortedNodeNames() const
        {
            TArray<FName> Names = Nodes->GetRowNames();
            Names.Sort([](const FName& A, const FName& B) { return A.ToString().Compare(B.ToString(), ESearchCase::CaseSensitive) < 0; });
            return Names;
        }
    };

    inline int32 MaxRank(const FSkillDefinitionRow& Skill) { return FMath::Max(1, Skill.MaxRank); }

    inline int32 Rank(const FTree& Tree, FName NodeId, const TMap<FName, int32>& Ranks)
    {
        const FSkillTreeNodeRow* Node = Tree.Node(NodeId);
        const FSkillDefinitionRow* Skill = Node ? Tree.Skill(*Node) : nullptr;
        return Skill ? FMath::Clamp(Ranks.FindRef(NodeId), 0, MaxRank(*Skill)) : 0;
    }

    // Σ rank x CostPerRank over the tree. ExceptNode excludes one placement's own investment.
    inline int32 TreePoints(const FTree& Tree, const TMap<FName, int32>& Ranks, FName ExceptNode = NAME_None)
    {
        int64 Total = 0;
        for (const FName& Name : Tree.Nodes->GetRowNames())
        {
            const FSkillTreeNodeRow* Node = Tree.Node(Name);
            const FSkillDefinitionRow* Skill = Node ? Tree.Skill(*Node) : nullptr;
            if (Skill && Name != ExceptNode) Total += int64(Rank(Tree, Name, Ranks)) * Skill->CostPerRank;
        }
        return int32(FMath::Min<int64>(Total, MAX_int32));
    }

    inline bool PrerequisitesMet(const FTree& Tree, const FSkillTreeNodeRow& Node, const TMap<FName, int32>& Ranks)
    {
        if (Node.Prerequisites.Num() == 0) return true;
        int32 Met = 0;
        for (const FName& ParentId : Node.Prerequisites)
        {
            const FSkillTreeNodeRow* Parent = Tree.Node(ParentId);
            const FSkillDefinitionRow* ParentSkill = Parent ? Tree.Skill(*Parent) : nullptr;
            if (!ParentSkill) continue;
            // A requirement above the parent's limit means "parent fully invested".
            const int32 Required = FMath::Clamp(Node.RequiredParentRank, 1, MaxRank(*ParentSkill));
            if (Rank(Tree, ParentId, Ranks) >= Required) ++Met;
        }
        return Node.PrerequisiteMode == ESkillPrerequisiteMode::Any ? Met > 0 : Met == Node.Prerequisites.Num();
    }

    inline EInvestResult Gate(const FTree& Tree, FName NodeId, const FSkillTreeNodeRow& Node, const TMap<FName, int32>& Ranks)
    {
        if (!PrerequisitesMet(Tree, Node, Ranks)) return EInvestResult::PrerequisitesNotMet;
        if (TreePoints(Tree, Ranks, NodeId) < Node.RequiredTreePoints) return EInvestResult::TreePointsNotMet;
        return EInvestResult::Ok;
    }

    inline EInvestResult CanInvest(const FTree& Tree, FName NodeId, const TMap<FName, int32>& Ranks, int32 AvailablePoints)
    {
        if (!Tree.IsValid()) return EInvestResult::UnknownNode;
        const FSkillTreeNodeRow* Node = Tree.Node(NodeId);
        const FSkillDefinitionRow* Skill = Node ? Tree.Skill(*Node) : nullptr;
        if (!Skill) return EInvestResult::UnknownNode;
        if (Rank(Tree, NodeId, Ranks) >= MaxRank(*Skill)) return EInvestResult::MaxRankReached;
        const EInvestResult Result = Gate(Tree, NodeId, *Node, Ranks);
        if (Result != EInvestResult::Ok) return Result;
        return AvailablePoints < Skill->CostPerRank ? EInvestResult::NotEnoughPoints : EInvestResult::Ok;
    }

    // Refund one rank only if every still-invested node keeps satisfying its unlock rules.
    inline bool CanRefund(const FTree& Tree, FName NodeId, const TMap<FName, int32>& Ranks)
    {
        if (!Tree.IsValid()) return false;
        const int32 Current = Rank(Tree, NodeId, Ranks);
        if (Current <= 0) return false;
        TMap<FName, int32> Next = Ranks;
        Next.Add(NodeId, Current - 1);
        for (const FName& Name : Tree.Nodes->GetRowNames())
        {
            const FSkillTreeNodeRow* Node = Tree.Node(Name);
            if (Node && Rank(Tree, Name, Next) > 0 && Gate(Tree, Name, *Node, Next) != EInvestResult::Ok) return false;
        }
        return true;
    }

    // Final = Base x (1 + ΣPercent / 100) + ΣFlat over every placed node's effects on StatId.
    inline double EvaluateStat(const FTree& Tree, FName StatId, const TMap<FName, int32>& Ranks, double BaseValue)
    {
        if (!Tree.IsValid() || StatId.IsNone()) return BaseValue;
        double Flat = 0.0;
        double Percent = 0.0;
        for (const FName& Name : Tree.SortedNodeNames())
        {
            const FSkillTreeNodeRow* Node = Tree.Node(Name);
            const FSkillDefinitionRow* Skill = Node ? Tree.Skill(*Node) : nullptr;
            if (!Skill) continue;
            const int32 NodeRank = Rank(Tree, Name, Ranks);
            for (const FSkillEffect& Effect : Skill->Effects)
            {
                if (Effect.StatId != StatId) continue;
                const double Amount = NodeRank * Effect.ValuePerRank;
                if (Effect.ModifierOp == ESkillModifierOp::Add) Flat += Amount;
                else Percent += Amount;
            }
        }
        return BaseValue * (1.0 + Percent / 100.0) + Flat;
    }

    struct FPreview
    {
        double CurrentBonus = 0.0;
        double Delta = 0.0;
        double NextBonus = 0.0;
        double CurrentValue = 0.0;
        double NextValue = 0.0;
        int32 CurrentRank = 0;
        int32 NextRank = 0;
        int32 MaxRank = 1;
        bool bMaxed = false;
        FText Description;
    };

    // Description for the next investment of NodeId. BaseValue is the game's base value for Effects[0].StatId.
    // Works on a copy of Ranks, so no points are spent.
    inline bool BuildPreview(const FTree& Tree, FName NodeId, const TMap<FName, int32>& Ranks, double BaseValue, FPreview& Out)
    {
        Out = FPreview();
        if (!Tree.IsValid() || !FMath::IsFinite(BaseValue)) return false;
        const FSkillTreeNodeRow* Node = Tree.Node(NodeId);
        const FSkillDefinitionRow* Skill = Node ? Tree.Skill(*Node) : nullptr;
        if (!Skill) return false;
        const FName StatId = Skill->Effects.Num() > 0 ? Skill->Effects[0].StatId : NAME_None;
        Out.MaxRank = MaxRank(*Skill);
        Out.CurrentRank = Rank(Tree, NodeId, Ranks);
        Out.bMaxed = Out.CurrentRank >= Out.MaxRank;
        Out.NextRank = Out.bMaxed ? Out.CurrentRank : Out.CurrentRank + 1;
        TMap<FName, int32> Next = Ranks;
        Next.Add(NodeId, Out.NextRank);
        Out.CurrentValue = EvaluateStat(Tree, StatId, Ranks, BaseValue);
        Out.NextValue = EvaluateStat(Tree, StatId, Next, BaseValue);
        Out.CurrentBonus = Out.CurrentValue - BaseValue;
        Out.NextBonus = Out.NextValue - BaseValue;
        Out.Delta = Out.NextValue - Out.CurrentValue;

        FText Template = Out.bMaxed ? Skill->MaxDescriptionTemplate : Skill->DescriptionTemplate;
        if (Out.bMaxed && Template.IsEmpty())
        {
            Template = NSLOCTEXT("SkillTree", "MaxDescription", "{DisplayName}: {CurrentBonus} (최대 투자 완료)");
        }
        if (StatId.IsNone() || Template.IsEmpty())
        {
            Out.Description = Skill->Description;
            return true;
        }
        FNumberFormattingOptions Options;
        Options.SetMaximumFractionalDigits(3);
        const auto Number = [&Options](double Value)
        {
            return FText::AsNumber(FMath::Abs(Value) < 0.0005 ? 0.0 : Value, &Options);
        };
        FFormatNamedArguments Args;
        Args.Add(TEXT("DisplayName"), Skill->DisplayName);
        Args.Add(TEXT("CurrentBonus"), Number(Out.CurrentBonus));
        Args.Add(TEXT("Delta"), Number(Out.Delta));
        Args.Add(TEXT("NextBonus"), Number(Out.NextBonus));
        Args.Add(TEXT("CurrentValue"), Number(Out.CurrentValue));
        Args.Add(TEXT("NextValue"), Number(Out.NextValue));
        Args.Add(TEXT("CurrentRank"), FText::AsNumber(Out.CurrentRank));
        Args.Add(TEXT("NextRank"), FText::AsNumber(Out.NextRank));
        Args.Add(TEXT("MaxRank"), FText::AsNumber(Out.MaxRank));
        Out.Description = FText::Format(Template, Args);
        return true;
    }
}
