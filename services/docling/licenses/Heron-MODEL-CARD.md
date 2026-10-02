---
license: apache-2.0
---

![heron_logo](docling_heron_400.png)

# Document Layout Analysis "heron"

🚀 **`heron`** is the **default layout analysis model** of the [Docling project](https://github.com/docling-project/docling), designed for robust and high-quality document layout understanding.

📄 For an in-depth description of the model architecture, training datasets, and evaluation methodology, please refer to our technical report: **"Advanced Layout Analysis Models for Docling"**, Nikolaos Livathinos *et al.*, 
[🔗 https://arxiv.org/abs/2509.11720](https://arxiv.org/abs/2509.11720)



## Inference code example

Prerequisites:

```bash
pip install transformers Pillow torch requests
```

Prediction:

```python
import requests
from transformers import RTDetrV2ForObjectDetection, RTDetrImageProcessor
import torch
from PIL import Image


classes_map = {
    0: "Caption",
    1: "Footnote",
    2: "Formula",
    3: "List-item",
    4: "Page-footer",
    5: "Page-header",
    6: "Picture",
    7: "Section-header",
    8: "Table",
    9: "Text",
    10: "Title",
    11: "Document Index",
    12: "Code",
    13: "Checkbox-Selected",
    14: "Checkbox-Unselected",
    15: "Form",
    16: "Key-Value Region",
}
image_url = "https://huggingface.co/spaces/ds4sd/SmolDocling-256M-Demo/resolve/main/example_images/annual_rep_14.png"
model_name = "docling-project/docling-layout-heron"
threshold = 0.6


# Download the image
image = Image.open(requests.get(image_url, stream=True).raw)
image = image.convert("RGB")

# Initialize the model
image_processor = RTDetrImageProcessor.from_pretrained(model_name)
model = RTDetrV2ForObjectDetection.from_pretrained(model_name)

# Run the prediction pipeline
inputs = image_processor(images=[image], return_tensors="pt")
with torch.no_grad():
    outputs = model(**inputs)
results = image_processor.post_process_object_detection(
    outputs,
    target_sizes=torch.tensor([image.size[::-1]]),
    threshold=threshold,
)

# Get the results
for result in results:
    for score, label_id, box in zip(
        result["scores"], result["labels"], result["boxes"]
    ):
        score = round(score.item(), 2)
        label = classes_map[label_id.item()]
        box = [round(i, 2) for i in box.tolist()]
        print(f"{label}:{score} {box}")
```


## References

```
@misc{livathinos2025advancedlayoutanalysismodels,
      title={advanced layout analysis models for docling},
      author={nikolaos livathinos and christoph auer and ahmed nassar and rafael teixeira de lima and maksym lysak and brown ebouky and cesar berrospi and michele dolfi and panagiotis vagenas and matteo omenetti and kasper dinkla and yusik kim and valery weber and lucas morin and ingmar meijer and viktor kuropiatnyk and tim strohmeyer and a. said gurbuz and peter w. j. staar},
      year={2025},
      eprint={2509.11720},
      archiveprefix={arxiv},
      primaryclass={cs.cv},
      url={https://arxiv.org/abs/2509.11720},
}

@techreport{Docling,
  author = {Deep Search Team},
  month = {8},
  title = {Docling Technical Report},
  url = {https://arxiv.org/abs/2408.09869v4},
  eprint = {2408.09869},
  doi = {10.48550/arXiv.2408.09869},
  version = {1.0.0},
  year = {2024}
}
```
