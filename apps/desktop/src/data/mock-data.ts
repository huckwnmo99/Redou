import type { AnnotationPreset, PaperRecord, TopCategory } from "../types";

export const initialCategories: TopCategory[] = [
  {
    id: "top-psa",
    name: "PSA",
    color: "#14b8a6",
    note: "압력 스윙 흡착 관련 핵심 논문을 모으는 상위 카테고리",
    subcategories: [
      {
        id: "sub-layered-beds",
        name: "Layered Beds",
        note: "레이어드 베드 구조와 downstream stability 관련 논문"
      },
      {
        id: "sub-recovery",
        name: "Recovery",
        note: "purity-recovery trade-off 관련 결과"
      },
      {
        id: "sub-co2",
        name: "CO2",
        note: "CO2 propagation과 보호 메커니즘"
      }
    ]
  },
  {
    id: "top-thesis-evidence",
    name: "Thesis Evidence",
    color: "#2563eb",
    note: "논문 작성과 주장 근거 정리를 위한 카테고리",
    subcategories: [
      {
        id: "sub-mechanism",
        name: "Mechanism",
        note: "메커니즘 설명에 직접 쓰이는 문단 중심"
      },
      {
        id: "sub-intro-claims",
        name: "Intro Claims",
        note: "서론 문장과 연결할 수 있는 배경 근거"
      }
    ]
  },
  {
    id: "top-presentation",
    name: "Presentation",
    color: "#d97706",
    note: "발표 후보 자료와 figure를 모으는 카테고리",
    subcategories: [
      {
        id: "sub-spring-talk",
        name: "Spring Talk",
        note: "다음 발표에서 바로 쓸 가능성이 있는 논문"
      }
    ]
  }
];

export const initialPapers: PaperRecord[] = [
  {
    id: "paper-layered-protection",
    title: "Layered adsorbent beds protect zeolite from carbon dioxide propagation",
    journal: "Industrial Gas Research",
    year: 2025,
    doi: "10.1000/redou.2025.001",
    readState: "important",
    summary:
      "Layered bed arrangement delayed carbon dioxide penetration and stabilized downstream hydrogen purity.",
    objective:
      "레이어드 베드 구조가 오염 전파와 정제 구간 안정성에 어떤 영향을 주는지 설명한다.",
    method:
      "Layer ordering, cycle timing, and adsorption pressure를 비교한 고정층 PSA 실험.",
    result:
      "CO2 front가 지연되고 polishing zeolite layer가 보호되면서 purity stability가 증가했다.",
    limitation:
      "사이클 타이밍과 feed 조성이 달라지면 효과 크기가 달라질 수 있다.",
    tags: ["PSA", "Layered", "CO2", "Zeolite"],
    noteCount: 6,
    highlightCount: 12,
    figureCount: 4,
    categories: [
      { topId: "top-psa", subId: "sub-layered-beds" },
      { topId: "top-thesis-evidence", subId: "sub-mechanism" }
    ]
  },
  {
    id: "paper-pressure-tradeoff",
    title: "Increasing adsorption pressure improved purity but decreased recovery",
    journal: "Adsorption Systems Letters",
    year: 2024,
    doi: "10.1000/redou.2024.014",
    readState: "reading",
    summary:
      "Higher adsorption pressure improved hydrogen purity while creating a recovery penalty under the tested cycle conditions.",
    objective:
      "adsorption pressure 변화가 purity와 recovery에 미치는 trade-off를 정량화한다.",
    method:
      "두 압력 구간에서 breakthrough, product purity, recovery를 비교.",
    result:
      "고압 조건에서 purity는 향상됐지만 recovery는 일관되게 하락했다.",
    limitation:
      "특정 feed composition과 cycle 조건에 한정된 결과다.",
    tags: ["Pressure", "Recovery", "Purity"],
    noteCount: 3,
    highlightCount: 5,
    figureCount: 2,
    categories: [
      { topId: "top-psa", subId: "sub-recovery" },
      { topId: "top-presentation", subId: "sub-spring-talk" }
    ]
  },
  {
    id: "paper-co2-control",
    title: "CO2 propagation control through upstream buffering layers",
    journal: "Separation Process Journal",
    year: 2023,
    doi: "10.1000/redou.2023.007",
    readState: "unread",
    summary:
      "Buffering layers lowered contaminant propagation speed and protected the polishing zone.",
    objective:
      "CO2 propagation을 늦추는 upstream buffering layer의 효과를 검증한다.",
    method:
      "layered and non-layered bed configurations를 같은 feed에서 비교.",
    result:
      "buffer layer가 없는 경우 대비 propagation onset이 뒤로 밀렸다.",
    limitation:
      "다른 adsorbent 조합에서 재현성 검증이 필요하다.",
    tags: ["CO2", "Buffer Layer", "Propagation"],
    noteCount: 1,
    highlightCount: 2,
    figureCount: 3,
    categories: [
      { topId: "top-psa", subId: "sub-co2" },
      { topId: "top-thesis-evidence", subId: "sub-intro-claims" }
    ]
  },
  {
    id: "paper-bed-architecture",
    title: "Bed architecture comparison for contaminant shielding",
    journal: "Gas Purification Review",
    year: 2022,
    doi: "10.1000/redou.2022.018",
    readState: "revisit",
    summary:
      "Multi-layer architecture showed better shielding performance than single-bed references.",
    objective:
      "bed architecture에 따른 shielding 효과를 비교한다.",
    method:
      "single bed, dual bed, layered bed를 동일 cycle에서 비교.",
    result:
      "layered bed가 breakthrough control에서 가장 안정적이었다.",
    limitation:
      "장기 운전 안정성까지는 포함하지 않았다.",
    tags: ["Architecture", "Breakthrough", "Shielding"],
    noteCount: 4,
    highlightCount: 8,
    figureCount: 5,
    categories: [{ topId: "top-psa", subId: "sub-layered-beds" }]
  }
];

export const annotationPresets: AnnotationPreset[] = [
  { id: "preset-important", name: "Important Result", colorClass: "accent-teal" },
  { id: "preset-revisit", name: "Revisit", colorClass: "accent-pink" },
  { id: "preset-method", name: "Method Note", colorClass: "accent-blue" },
  { id: "preset-my-research", name: "My Research", colorClass: "accent-green" }
];

export const initialSearchQuery = "pressure recovery trade-off";

