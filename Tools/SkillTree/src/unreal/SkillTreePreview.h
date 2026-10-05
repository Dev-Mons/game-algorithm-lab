#pragma once

#include "SkillTreeRow.h"

// Native C++ reference for the web editor's effects.ts. No JS runtime is required.
// Investment keys are DataTable ROW names, not SkillId. BaseValue is supplied by
// the game for the selected StatId. This does not spend points or check unlocks.
namespace SkillTreePreview
{
    struct FResult
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

    inline bool HasExpectedRows(const UDataTable& Table)
    {
        return Table.GetRowStruct() && Table.GetRowStruct()->IsChildOf(FSkillTreeRow::StaticStruct());
    }

    inline int32 Rank(const FSkillTreeRow& Row, FName NodeId, const TMap<FName, int32>& Investments)
    {
        return FMath::Clamp(Investments.FindRef(NodeId), 0, FMath::Max(1, Row.MaxLevel));
    }

    // Reuse this function for real stat application as well as description previews.
    inline double Evaluate(const UDataTable& Table, FName StatId,
        const TMap<FName, int32>& Investments, double BaseValue)
    {
        if (!HasExpectedRows(Table) || StatId.IsNone()) return BaseValue;
        double Flat = 0.0;
        double Percent = 0.0;
        // Match the editor's ordinal row-ID summation order for reproducibility.
        TArray<FName> Names = Table.GetRowNames();
        Names.Sort([](const FName& A, const FName& B) { return A.ToString().Compare(B.ToString(), ESearchCase::CaseSensitive) < 0; });
        for (const FName& Name : Names)
        {
            const FSkillTreeRow* Row = Table.FindRow<FSkillTreeRow>(Name, TEXT("SkillTreePreview"), false);
            if (!Row || Row->StatId != StatId) continue;
            const double Amount = Rank(*Row, Name, Investments) * Row->ValuePerRank;
            if (Row->ModifierOp == TEXT("Add")) Flat += Amount;
            else if (Row->ModifierOp == TEXT("AddPercent")) Percent += Amount;
        }
        return BaseValue * (1.0 + Percent / 100.0) + Flat;
    }

    inline bool Build(const UDataTable& Table, FName NodeId,
        const TMap<FName, int32>& Investments, double BaseValue, FResult& Out)
    {
        Out = FResult();
        if (!HasExpectedRows(Table) || !FMath::IsFinite(BaseValue)) return false;
        const FSkillTreeRow* Row = Table.FindRow<FSkillTreeRow>(NodeId, TEXT("SkillTreePreview"), false);
        if (!Row) return false;
        Out.MaxRank = FMath::Max(1, Row->MaxLevel);
        Out.CurrentRank = Rank(*Row, NodeId, Investments);
        Out.bMaxed = Out.CurrentRank >= Out.MaxRank;
        Out.NextRank = Out.bMaxed ? Out.CurrentRank : Out.CurrentRank + 1;
        TMap<FName, int32> NextInvestments = Investments;
        NextInvestments.Add(NodeId, Out.NextRank);
        Out.CurrentValue = Evaluate(Table, Row->StatId, Investments, BaseValue);
        Out.NextValue = Evaluate(Table, Row->StatId, NextInvestments, BaseValue);
        Out.CurrentBonus = Out.CurrentValue - BaseValue;
        Out.NextBonus = Out.NextValue - BaseValue;
        Out.Delta = Out.NextValue - Out.CurrentValue;

        FText Template = Out.bMaxed ? Row->MaxDescriptionTemplate : Row->DescriptionTemplate;
        if (Out.bMaxed && Template.IsEmpty())
        {
            Template = NSLOCTEXT("SkillTree", "MaxDescription", "{DisplayName}: {CurrentBonus} (최대 투자 완료)");
        }
        if (Row->StatId.IsNone() || Template.IsEmpty())
        {
            Out.Description = Row->Description;
            return true;
        }
        FNumberFormattingOptions Options;
        Options.SetMaximumFractionalDigits(3);
        const auto Number = [&Options](double Value)
        {
            return FText::AsNumber(FMath::Abs(Value) < 0.0005 ? 0.0 : Value, &Options);
        };
        FFormatNamedArguments Args;
        Args.Add(TEXT("DisplayName"), Row->DisplayName);
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
