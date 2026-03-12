import type { Folder } from "@/types/paper";

export const mockFolders: Folder[] = [
  {
    id: "f1",
    name: "NLP & Language Models",
    paperCount: 0,
  },
  {
    id: "f1a",
    name: "Transformers",
    parentId: "f1",
    paperCount: 0,
  },
  {
    id: "f1b",
    name: "Scaling & Adaptation",
    parentId: "f1",
    paperCount: 0,
  },
  {
    id: "f2",
    name: "Computer Vision",
    paperCount: 0,
  },
  {
    id: "f2a",
    name: "Vision Transformers",
    parentId: "f2",
    paperCount: 0,
  },
  {
    id: "f2b",
    name: "Segmentation & Foundation Models",
    parentId: "f2",
    paperCount: 0,
  },
  {
    id: "f3",
    name: "Generative Models",
    paperCount: 0,
  },
  {
    id: "f3a",
    name: "GANs",
    parentId: "f3",
    paperCount: 0,
  },
  {
    id: "f3b",
    name: "Diffusion",
    parentId: "f3",
    paperCount: 0,
  },
  {
    id: "f4",
    name: "AI Safety & Alignment",
    paperCount: 0,
  },
  {
    id: "f4a",
    name: "Harmlessness",
    parentId: "f4",
    paperCount: 0,
  },
  {
    id: "f4b",
    name: "Knowledge Systems",
    parentId: "f4",
    paperCount: 0,
  },
];
