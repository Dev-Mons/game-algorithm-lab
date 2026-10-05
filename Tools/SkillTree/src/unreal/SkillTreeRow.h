#pragma once

#include "CoreMinimal.h"
#include "Engine/DataTable.h"
#include "SkillTreeRow.generated.h"

// Copy into your Unreal project's Source/<Module>/ folder and compile.
// JSON "Name" is the DataTable row key, not a struct property.
USTRUCT(BlueprintType)
struct FSkillTreeRow : public FTableRowBase
{
    GENERATED_BODY()

    // Shared skill definition ID. Multiple node rows may reference one skill.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    FName SkillId;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    FText DisplayName;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    FText Description;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Effect")
    FName StatId;

    // Add or AddPercent. Percentage points are summed before applying to BaseValue.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Effect")
    FString ModifierOp = TEXT("Add");

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Effect")
    double ValuePerRank = 0.0;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Effect")
    FText DescriptionTemplate;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Effect")
    FText MaxDescriptionTemplate;

    // CanvasPanelSlot position, top-left anchor (0,0) and alignment (0,0).
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Layout")
    float X = 0.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Layout")
    float Y = 0.0f;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    FString Category;

    // Stored as a string; resolve/load the asset in your game if needed.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    FString Icon;

    // Symbol ID from the editor's Game-icons palette; map to an asset in your game.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Layout")
    FString IconSymbol = TEXT("machine-gun");

    // Square, Diamond or Circle. Shape stays inside the NodeSize square bounds.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Layout")
    FString NodeShape = TEXT("Square");

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Layout")
    int32 NodeSize = 36;

    // #RRGGBB, parsed by the consuming widget as an sRGB color.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Layout")
    FString NodeColor = TEXT("#d8c089");

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    int32 Cost = 1;

    // Maximum number of investments in this skill (1 means a one-time unlock).
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill", meta = (ClampMin = "1"))
    int32 MaxLevel = 1;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    TArray<FName> Prerequisites;

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    TArray<FString> Tags;

    // JSON object encoded as a string to keep a stable DataTable schema.
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Skill")
    FString CustomData = TEXT("{}");
};
