# LabRat Test Workbooks

These synthetic Excel files are for manual LabRat smoke tests. They are not scientific data.

## Hollow Marker / No-Line Scatter Flow

1. Create or open a server project.
2. Upload `LabRat_Test_Master_Exp30.xlsx` as the Master Dataset.
3. Review, normalize, and apply the import.
4. Upload `LabRat_Test_Reaction_Rate_Exp30.xlsx` as a Supplemental Workbook.
5. Accept the relationship to `Exp30`, then apply the supplemental import.
6. In Review chart proposals, ask:

```text
plot adjusted rate vs reaction time for Exp30 with hollow markers, no connecting lines, and log base 10 y-axis
```

Expected result:

- `scatter`
- x-axis: `Reaction Time (min)` from column F
- y-axis: `Adjusted Rate (M/s)` from column H
- y-axis log scale
- marker-only preview
- open-circle markers

## Normalized Selectivity Flow

Upload `LabRat_Test_Selectivity_Normalize.xlsx` as a Master Dataset, then ask:

```text
make a stacked bar chart of solid liquid gas selectivity and rescale them proportionally so each experiment sums to 100 percent
```

Expected result:

- `stacked_bar`
- `normalize_sum_to_percent` transform
- each experiment stack sums to 100%
