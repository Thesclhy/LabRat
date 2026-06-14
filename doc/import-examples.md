# Import Parsing Examples

These examples are small text mockups of lab workbook layouts. They describe parser targets and regression scenarios for backend import work. Generated workbook fixtures already cover several of these patterns; keep fixtures, parser tests, and expected outputs aligned with this file.

## Example 1: Clean Standard Table

Input sheet: `Runs`

```text
Experiment | Time (min) | Conversion (%) | Selectivity (%)
Exp1       | 0          | 0              | 0
Exp1       | 10         | 25             | 80
Exp2       | 0          | 0              | 0
Exp2       | 10         | 35             | 82
```

Expected scan result:

- layout: `standard_table`
- blocks: 1
- title: absent
- metadata: none
- columns: `Experiment`, `Time` with unit `min`, `Conversion` with unit `%`, `Selectivity` with unit `%`
- data rows: 4
- warnings: none unless units cannot be parsed
- provenance: header cells and data row ranges must point back to `Runs`

Expected normalized direction:

- create or match experiments `Exp1` and `Exp2`
- create time-series measurements for conversion and selectivity
- preserve each row cell as source-backed data

## Example 2: Repeated Block Table

Input sheet: `Run Data`

```text
Experiment 1
Temperature: 80 C
Pressure: 2 bar
Catalyst | Ni

Time (min) | Conversion (%) | Selectivity (%)
0          | 0              | 0
10         | 25             | 80
20         | 45             | 76

Experiment 2
Temperature: 90 C
Pressure: 3 bar
Catalyst | Ru/TiO2

Time (min) | Conversion (%) | Selectivity (%)
0          | 0              | 0
10         | 34             | 82
20         | 55             | 79
```

Expected scan result:

- layout: `block_table`
- blocks: 2
- each block has a title row, metadata rows, one header row, and three data rows
- metadata keys: `Temperature`, `Pressure`, `Catalyst`
- units: `C`, `bar`, `min`, `%`
- warnings: none if both blocks parse cleanly
- confidence should be high because repeated headers and block titles are obvious

Expected normalized direction:

- create two experiments named from block titles unless user remaps names
- attach block metadata to each experiment
- attach table rows as measurements linked to the source block

## Example 3: Matrix Or Wide Table

Input sheet: `Summary`

```text
        | Exp1 | Exp2 | Exp3
Temp C  | 80   | 90   | 100
Conv %  | 25   | 35   | 50
Sel %   | 80   | 82   | 76
```

Expected scan result:

- layout: `matrix_table` in a future parser, or `unknown` with a matrix-layout warning in the current conservative parser
- candidate experiment columns: `Exp1`, `Exp2`, `Exp3`
- candidate measurement rows: `Temp C`, `Conv %`, `Sel %`
- warnings: `Matrix orientation inferred` or `Matrix layout not implemented`
- provenance: every matrix value should retain its source cell

Expected normalized direction:

- create or match experiments by column
- create scalar metadata or measurements from row names
- require review before accepting inferred orientation

## Example 4: Mixed Report

Input sheet: `Report`

```text
Daily catalyst screening notes
Operator: HL
Instrument: Parr 4560

Summary: Run 1 reached target pressure after 8 minutes.
Do not use the first GC point.

Run | Temp (C) | Time (min) | Conversion (%)
1   | 80       | 10         | 25
2   | 90       | 10         | 35
3   | 100      | 10         | 50

Notes
Run 2 had a small pressure fluctuation.
```

Expected scan result:

- layout: `mixed_report` in a future parser, or `standard_table`/`unknown` with warnings in the current conservative parser
- detected metadata: `Operator`, `Instrument`
- detected table: one table with four columns and three data rows
- notes should be preserved as warnings or note candidates, not parsed as numeric data
- warnings: report contains free text outside the detected table

Expected normalized direction:

- preserve report-level metadata separately from experiment-level metadata
- attach notes to source context for review
- avoid inventing run meaning beyond visible values

## Example 5: Ambiguous Sparse Sheet

Input sheet: `Sheet1`

```text
Temperature
80

good run maybe

25 80 2
30 bad 3
```

Expected scan result:

- layout: `unknown`
- blocks: candidate regions only
- warnings:
  - `No clear header row found`
  - `Units could not be determined`
  - `Mixed value types in candidate data region`
- confidence: low

Expected normalized direction:

- do not create experiments automatically
- allow user or future AI mapping to inspect compact summaries
- preserve raw candidate regions for review
