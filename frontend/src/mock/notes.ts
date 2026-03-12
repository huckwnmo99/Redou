import type { ResearchNote } from "@/types/paper";

export const mockNotes: ResearchNote[] = [
  {
    id: "n1",
    paperId: "p1",
    title: "Transformer core claim",
    kind: "summary",
    content:
      "The paper's central move is replacing recurrence with attention-only blocks, which reduces path length between tokens and makes scaling easier.",
    anchorLabel: "Abstract",
    pinned: true,
    createdAt: "2024-11-01T09:20:00",
    updatedAt: "2024-11-02T08:10:00",
  },
  {
    id: "n2",
    paperId: "p1",
    title: "Reuse in reading flow",
    kind: "action",
    content:
      "Turn the encoder-decoder comparison into a reusable note template for future architecture papers.",
    anchorLabel: "Section 3",
    createdAt: "2024-11-02T10:35:00",
    updatedAt: "2024-11-03T11:40:00",
  },
  {
    id: "n3",
    paperId: "p1",
    title: "Question about positional encoding",
    kind: "question",
    content:
      "Need to revisit how much of the gain comes from attention versus the sinusoidal encoding choice in the original setup.",
    anchorLabel: "Figure 1",
    createdAt: "2024-11-04T12:10:00",
    updatedAt: "2024-11-04T12:10:00",
  },
  {
    id: "n4",
    paperId: "p2",
    title: "Bidirectional objective",
    kind: "summary",
    content:
      "BERT's practical advantage comes from joint left-right context during pretraining, which changes how transfer tasks are framed.",
    anchorLabel: "Abstract",
    pinned: true,
    createdAt: "2024-11-05T08:30:00",
    updatedAt: "2024-11-05T08:30:00",
  },
  {
    id: "n5",
    paperId: "p2",
    title: "Compare with GPT-style masking",
    kind: "insight",
    content:
      "Keep this note next to autoregressive papers because the difference in masking objective shapes downstream prompting behavior.",
    anchorLabel: "Method",
    createdAt: "2024-11-05T14:15:00",
    updatedAt: "2024-11-06T09:25:00",
  },
  {
    id: "n6",
    paperId: "p3",
    title: "Vision patches as tokens",
    kind: "summary",
    content:
      "The patch embedding step is the conceptual bridge that makes vision transformers legible from an NLP mindset.",
    anchorLabel: "Figure 2",
    createdAt: "2024-11-10T15:00:00",
    updatedAt: "2024-11-10T15:00:00",
  },
  {
    id: "n7",
    paperId: "p4",
    title: "Residual path intuition",
    kind: "quote",
    content:
      "Residual mapping reframes depth as learning a correction rather than rebuilding the full transformation each layer.",
    anchorLabel: "Section 4.1",
    createdAt: "2024-10-20T09:05:00",
    updatedAt: "2024-10-21T10:10:00",
  },
  {
    id: "n8",
    paperId: "p4",
    title: "Why this still matters",
    kind: "insight",
    content:
      "Even outside CV, the residual idea is a good explanatory anchor when summarizing optimization tricks in later transformer work.",
    anchorLabel: "Conclusion",
    createdAt: "2024-10-22T11:25:00",
    updatedAt: "2024-10-23T09:45:00",
  },
  {
    id: "n9",
    paperId: "p5",
    title: "GAN framing",
    kind: "summary",
    content:
      "The adversarial game is less about image quality and more about defining a learning signal when explicit likelihoods are hard to optimize.",
    anchorLabel: "Introduction",
    createdAt: "2024-10-15T16:00:00",
    updatedAt: "2024-10-16T09:10:00",
  },
  {
    id: "n10",
    paperId: "p6",
    title: "Scaling takeaway",
    kind: "summary",
    content:
      "Few-shot performance is presented as an emergent property of scale, so this note should stay close to the scaling-law folder.",
    anchorLabel: "Section 1",
    pinned: true,
    createdAt: "2024-11-15T08:40:00",
    updatedAt: "2024-11-16T13:20:00",
  },
  {
    id: "n11",
    paperId: "p6",
    title: "Benchmark caution",
    kind: "question",
    content:
      "Need a cleaner note on which benchmark gains are robust versus benchmark-specific prompt sensitivity.",
    anchorLabel: "Appendix G",
    createdAt: "2024-11-17T10:50:00",
    updatedAt: "2024-11-18T08:15:00",
  },
  {
    id: "n12",
    paperId: "p9",
    title: "Parametric vs non-parametric memory",
    kind: "summary",
    content:
      "RAG is valuable here because it separates what the model stores internally from what can stay external and refreshable.",
    anchorLabel: "Overview",
    pinned: true,
    createdAt: "2024-11-28T09:00:00",
    updatedAt: "2024-11-29T08:40:00",
  },
  {
    id: "n13",
    paperId: "p9",
    title: "Frontend implication",
    kind: "action",
    content:
      "When RAG lands in Redou, the answer view should always show which note or chunk grounded the response.",
    anchorLabel: "Figure 3",
    createdAt: "2024-11-29T10:10:00",
    updatedAt: "2024-11-29T10:10:00",
  },
  {
    id: "n14",
    paperId: "p11",
    title: "LoRA as practical adapter",
    kind: "summary",
    content:
      "The most useful mental model is that LoRA preserves the frozen base model while making adaptation cheap and portable.",
    anchorLabel: "Method",
    createdAt: "2024-11-20T08:05:00",
    updatedAt: "2024-11-21T09:30:00",
  },
  {
    id: "n15",
    paperId: "p11",
    title: "Comparison note",
    kind: "insight",
    content:
      "Tie this paper to scaling and fine-tuning folders because it helps explain why adaptation strategy is now a product decision, not just a training detail.",
    anchorLabel: "Table 2",
    createdAt: "2024-11-21T10:15:00",
    updatedAt: "2024-11-22T11:45:00",
  },
];
