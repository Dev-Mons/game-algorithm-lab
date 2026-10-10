#pragma once

#include "CoreMinimal.h"
#include "Engine/DataTable.h"
#include "SkillTreeTypes.generated.h"

// Row structs for Skill Tree Studio's split DataTable export.
// Copy into your Unreal project's Source/<Module>/ folder and compile before importing.
// JSON "Name" (or the first CSV column) is the DataTable Row Name, not a struct property.
//
//   DT_<TreeId>_Tree   -> FSkillTreeLayoutRow   (Row Name = TreeId)
//   DT_<TreeId>_Skills -> FSkillDefinitionRow   (Row Name = SkillId, shared definition)
//   DT_<TreeId>_Nodes  -> FSkillTreeNodeRow     (Row Name = NodeId, one per placement, investment key)
//   DT_<TreeId>_Links  -> FSkillTreeLinkRow     (Row Name = <From>__<To>, precomputed line geometry)

UENUM(BlueprintType)
enum class ESkillModifierOp : uint8
{
    // Flat amount, added after percentages.
    Add,
    // Percentage points. All AddPercent effects on one StatId are summed, then applied to the base value only.
    AddPercent
};

UENUM(BlueprintType)
enum class ESkillNodeShape : uint8
{
    Square,
    Diamond,
    Circle
};

UENUM(BlueprintType)
enum class ESkillPrerequisiteMode : uint8
{
    // Every prerequisite node must reach RequiredParentRank.
    All,
    // At least one prerequisite node must reach RequiredParentRank.
    Any
};

USTRUCT(BlueprintType)
struct FSkillEffect
{
    GENERATED_BODY()

    // Effect tag registered in the editor, e.g. MachineGun.Damage. Effects on the same StatId are summed.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Effect")
    FName StatId;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Effect")
    ESkillModifierOp ModifierOp = ESkillModifierOp::Add;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Effect")
    double ValuePerRank = 0.0;
};

// Shared skill definition. Several placements (FSkillTreeNodeRow) may reference the same SkillId.
USTRUCT(BlueprintType)
struct FSkillDefinitionRow : public FTableRowBase
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    FText DisplayName;

    // Plain description, used when the skill has no effect or no template.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    FText Description;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    FString Category;

    // Texture or material for the node brush. Empty means "use IconSymbol mapping".
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Appearance", meta = (AllowedClasses = "/Script/Engine.Texture2D,/Script/Engine.MaterialInterface"))
    TSoftObjectPtr<UObject> Icon;

    // Editor palette symbol ID (Game-icons.net name). Map to an asset in your game if Icon is empty.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Appearance")
    FName IconSymbol;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Appearance")
    ESkillNodeShape Shape = ESkillNodeShape::Square;

    // Square bounds in canvas units. The shape is drawn inside this square.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Appearance", meta = (ClampMin = "24", ClampMax = "96"))
    int32 Size = 36;

    // sRGB color. Use FLinearColor(Color) or Blueprint "To LinearColor" for brush tints.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Appearance")
    FColor Color = FColor(216, 192, 137, 255);

    // Maximum number of investments (1 = one-time unlock).
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rank", meta = (ClampMin = "1"))
    int32 MaxRank = 1;

    // Skill points spent per investment.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Rank", meta = (ClampMin = "0"))
    int32 CostPerRank = 1;

    // The editor currently writes 0 or 1 effect; the array keeps the schema open for multi-effect skills.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Effect")
    TArray<FSkillEffect> Effects;

    // FText::Format templates using {DisplayName} {CurrentBonus} {Delta} {NextBonus} {CurrentValue}
    // {NextValue} {CurrentRank} {NextRank} {MaxRank}. Values come from Effects[0].
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Effect")
    FText DescriptionTemplate;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Effect")
    FText MaxDescriptionTemplate;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    TArray<FName> Tags;

    // JSON object encoded as a string to keep a stable DataTable schema.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    FString CustomData = TEXT("{}");
};

// One placed node in the tree. Its Row Name is the investment key.
USTRUCT(BlueprintType)
struct FSkillTreeNodeRow : public FTableRowBase
{
    GENERATED_BODY()

    // Row Name in the Skills table.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Node")
    FName SkillId;

    // Top-left corner in canvas units (+X right, +Y down). Subtract the tree's CanvasMin for a 0-based canvas.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Layout")
    FVector2D Position = FVector2D::ZeroVector;

    // Node Row Names that unlock this node.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Unlock")
    TArray<FName> Prerequisites;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Unlock")
    ESkillPrerequisiteMode PrerequisiteMode = ESkillPrerequisiteMode::All;

    // Investments each counted prerequisite needs. Values above a parent's MaxRank mean "parent fully invested".
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Unlock", meta = (ClampMin = "1"))
    int32 RequiredParentRank = 1;

    // Points (rank x CostPerRank) already spent on OTHER nodes of this tree.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Unlock", meta = (ClampMin = "0"))
    int32 RequiredTreePoints = 0;

    // Generated: longest prerequisite chain from a start node (start nodes are 0). Useful for tiers or reveal order.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Layout")
    int32 Depth = 0;
};

// Generated line between node borders. Draw an Image at Start with alignment/pivot (0, 0.5),
// width Length and RenderTransform angle AngleDegrees (clockwise because +Y is down).
USTRUCT(BlueprintType)
struct FSkillTreeLinkRow : public FTableRowBase
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Link")
    FName From;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Link")
    FName To;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Link")
    FVector2D Start = FVector2D::ZeroVector;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Link")
    FVector2D End = FVector2D::ZeroVector;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Link")
    float Length = 0.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Link")
    float AngleDegrees = 0.0f;
};

// Tree entry: canvas bounds and the tables that make up the tree.
USTRUCT(BlueprintType)
struct FSkillTreeLayoutRow : public FTableRowBase
{
    GENERATED_BODY()

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Tree")
    FText DisplayName;

    // Top-left of the node bounding box. Node slot position = Node.Position - CanvasMin (+ your padding).
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Layout")
    FVector2D CanvasMin = FVector2D::ZeroVector;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Layout")
    FVector2D CanvasSize = FVector2D::ZeroVector;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Tree")
    TArray<FName> RootNodes;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Tree")
    TSoftObjectPtr<UDataTable> SkillTable;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Tree")
    TSoftObjectPtr<UDataTable> NodeTable;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Tree")
    TSoftObjectPtr<UDataTable> LinkTable;
};
