# N-ATLAS Model Notes (verified from official model card)

Source: [huggingface.co/NCAIR1/N-ATLaS](https://huggingface.co/NCAIR1/N-ATLaS)
(fetched and verified, not assumed, record here so the team doesn't have to
re-check this mid-build).

## Architecture
- Base: **Llama-3 8B** (`LlamaForCausalLM`)
- Hidden size 4,096, 32 layers, 32 attention heads, vocab 128,256
- **Context length: 8,092 tokens**, hard ceiling for both fine-tuning and
  inference. Our LoRA config uses `max_seq_length: 2048`, well within this;
  don't raise it casually.

## Loading (from the model card)
```python
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch

model_name = "NCAIR1/N-ATLaS"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    torch_dtype=torch.float16,
    device_map="auto"
)
```
This matches what `ml/src/finetune_lora.py` builds on (adds 4-bit
quantization + LoRA adapters on top of this base load).

## Languages & known performance gaps
- English (primary), Hausa, Igbo, Yoruba
- Human eval scores: English 4.21/5.0, Hausa 3.98/5.0, Igbo 3.87/5.0,
  **Yoruba 2.69/5.0 (noticeably weaker)**
- Our earlier decision to author English-only for now (see project history)
  conveniently sidesteps N-ATLAS's weakest-performing language. If the team
  later adds Yoruba/Hausa/Igbo examples, budget extra review time for
  Yoruba specifically, the base model's own competence there is lower, so
  fine-tuning quality is more sensitive to how good input data is.

## Repo contents
- Safetensors weights, tokenizer files
- **2 pre-existing adapter models already on the repo**, worth a quick look
  before assuming a from-scratch LoRA is the only option; they may be
  relevant baselines or starting points, or may be unrelated to our use
  case. Check `huggingface.co/NCAIR1/N-ATLaS` -> Files tab before the real
  training run.
- 5 quantized versions available (useful if GPU memory is tight for
  inference/benchmarking, separate from the 4-bit QLoRA training setup)

## License, read before demo/submission
**Open-Source Research and Innovation License**, key restrictions:
- Limited to organizations with **≤1,000 active end-users**, fine for a
  competition demo/prototype, but flag this if the "scalability and
  sustainability pathway" section of the submission talks about scaling
  beyond that without addressing licensing.
- **Commercial use requires separate licensing**, don't imply commercial
  deployment readiness in the pitch without noting this.
- **Attribution required: "Powered by Awarri Technologies"**, add this
  credit line to the chat app UI footer and to the technical documentation.
  Currently missing from `app/index.html`, add before submission.
- Governed by Nigerian law.

**Permitted uses** (we're squarely inside this): academic research,
accessibility, cultural preservation, civic technology, **education**.

**Prohibited uses**: surveillance, discriminatory profiling, disinformation,
military/weaponized deployment. Not relevant to this project but worth
citing in docs to show license compliance was actually checked.

## Known limitations (from the model card, cite honestly in docs)
- Some bias issues identified
- Dialectal and accent bias
- Reduced accuracy with children's speech
- Limited code-switching handling
- Poor performance in noisy environments (relevant if voice/ASR is ever
  added later, not in our current text-only scope)

## Inference availability
**Not deployed by any hosted inference provider**, there is no public API
endpoint to call. This confirms: both the "base model" benchmark run and
the fine-tuned model must be **self-hosted** (local GPU, Colab/Kaggle, or a
rented box using NAIC's compute credits once shortlisted). Plan for this in
the timeline, `ml/eval/benchmark.py`'s `--model-endpoint` flag expects a
URL you stand up yourself; there is no NCAIR/HF-hosted URL to point at.

## Contact (from model card, for reference)
Awarri Technologies, datasupport@awarri.com, and the Federal Ministry of
Communications, Innovation and Digital Economy. Use the NAIC contact
(naic@nitda.gov.ng) for competition-specific questions instead.
