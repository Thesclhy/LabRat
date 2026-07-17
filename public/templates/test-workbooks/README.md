# LabRat Test Workbooks

These synthetic Excel files are for manual LabRat smoke tests. They are not scientific data.

## Workbook To Experiment Browser

1. Create or open a server project.
2. Upload `LabRat_Test_Master.xlsx`.
3. Review the detected red boxes. Mark the `README` range as documentation to ignore and keep `Runs!A1:K5` as the experiment table.
4. Confirm the structured workbook understanding.
5. Review the extracted experiment preview, choose `Create new` for `Exp28` through `Exp31`, and publish.
6. Open Experiment Browser and compare the accepted scalar fields across the four experiments.

Expected result:

- four accepted Browser rows: `Exp28`, `Exp29`, `Exp30`, and `Exp31`
- source-backed detail links to `Runs!A1:K5`
- no legacy dataset, normalize/apply, or supplemental-import step

## Source-Backed Reaction Rate Chart

1. Upload `LabRat_Test_Reaction_Rate_Exp30.xlsx` as another workbook source.
2. Review and confirm the reaction-rate source range for `Exp30`.
3. In Review chart proposals, ask:

```text
plot adjusted rate vs reaction time for Exp30 with hollow markers, no connecting lines, and log base 10 y-axis
```

Expected result:

- `scatter`
- x-axis: `Reaction Time (min)` from column F
- y-axis: `Adjusted Rate (M/s)` from column H
- y-axis log scale
- marker-only preview with open-circle markers

## Source-Backed Selectivity Chart

Upload and review `LabRat_Test_Selectivity_Normalize.xlsx`, then ask:

```text
make a stacked bar chart of solid liquid gas selectivity and rescale them proportionally so each experiment sums to 100 percent
```

Expected result:

- `stacked_bar`
- `normalize_sum_to_percent` transform
- each experiment stack sums to 100%
