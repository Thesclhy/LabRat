---
license: cdla-permissive-2.0
---

# Docling Models

This page contains models that power the PDF document converion package [docling](https://github.com/DS4SD/docling).

## Layout Model

The layout model will take an image from a page and apply RT-DETR model in order to find different layout components. It currently detects the labels: Caption, Footnote, Formula, List-item, Page-footer, Page-header, Picture, Section-header, Table, Text, Title. As a reference (from the DocLayNet-paper), this is the performance of standard object detection methods on the DocLayNet dataset compared to human evaluation, 

|                | human   | MRCNN   | MRCNN   | FRCNN   | YOLO   |
|----------------|---------|---------|---------|---------|--------|
|                | human   | R50     | R101    | R101    | v5x6   |
| Caption        | 84-89   | 68.4    | 71.5    | 70.1    | 77.7   |
| Footnote       | 83-91   | 70.9    | 71.8    | 73.7    | 77.2   |
| Formula        | 83-85   | 60.1    | 63.4    | 63.5    | 66.2   |
| List-item      | 87-88   | 81.2    | 80.8    | 81.0    | 86.2   |
| Page-footer    | 93-94   | 61.6    | 59.3    | 58.9    | 61.1   |
| Page-header    | 85-89   | 71.9    | 70.0    | 72.0    | 67.9   |
| Picture        | 69-71   | 71.7    | 72.7    | 72.0    | 77.1   |
| Section-header | 83-84   | 67.6    | 69.3    | 68.4    | 74.6   |
| Table          | 77-81   | 82.2    | 82.9    | 82.2    | 86.3   |
| Text           | 84-86   | 84.6    | 85.8    | 85.4    | 88.1   |
| Title          | 60-72   | 76.7    | 80.4    | 79.9    | 82.7   |
| All            | 82-83   | 72.4    | 73.5    | 73.4    | 76.8   |

## TableFormer

The tableformer model will identify the structure of the table, starting from an image of a table. It uses the predicted table regions of the layout model to identify the tables. Tableformer has SOTA table structure identification,

| Model (TEDS) | Simple table | Complex table | All tables |
| ------------ | ------------ | ------------- | ---------- |
|       Tabula |         78.0 |          57.8 |       67.9 |
|    Traprange |         60.8 |          49.9 |       55.4 |
|      Camelot |         80.0 |          66.0 |       73.0 |
|  Acrobat Pro |         68.9 |          61.8 |       65.3 |
|          EDD |         91.2 |          85.4 |       88.3 |
|  TableFormer |         95.4 |          90.1 |       93.6 |

## References

```
@techreport{Docling,
  author = {Deep Search Team},
  month = {8},
  title = {{Docling Technical Report}},
  url={https://arxiv.org/abs/2408.09869},
  eprint={2408.09869},
  doi = "10.48550/arXiv.2408.09869",
  version = {1.0.0},
  year = {2024}
}

@article{doclaynet2022,
  title = {DocLayNet: A Large Human-Annotated Dataset for Document-Layout Analysis},  
  doi = {10.1145/3534678.353904},
  url = {https://arxiv.org/abs/2206.01062},
  author = {Pfitzmann, Birgit and Auer, Christoph and Dolfi, Michele and Nassar, Ahmed S and Staar, Peter W J},
  year = {2022}
}

@InProceedings{TableFormer2022,
    author    = {Nassar, Ahmed and Livathinos, Nikolaos and Lysak, Maksym and Staar, Peter},
    title     = {TableFormer: Table Structure Understanding With Transformers},
    booktitle = {Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)},
    month     = {June},
    year      = {2022},
    pages     = {4614-4623},
    doi = {https://doi.org/10.1109/CVPR52688.2022.00457}
}
```
