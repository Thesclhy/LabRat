export const LABRAT_TEMPLATE_LAYOUT = "LABRAT_TEMPLATE_WIDE";
export const LABRAT_FIGURE_MASTER = "LabRat Figure";
export const LABRAT_TEMPLATE_MASTERS = [
  "Title Slide",
  "Title and Content",
  "Section Header",
  "Two Content",
  "Comparison",
  "Title Only",
  "Blank",
  "Picture with Caption",
  LABRAT_FIGURE_MASTER,
];

const WHITE = "FFFFFF";
const TEXT = "1F2937";
const MUTED = "64748B";
const ACCENT = "2563EB";

function titlePlaceholder(x, y, w, h, text = "Click to add title") {
  return {
    placeholder: {
      options: {
        name: "title",
        type: "title",
        x,
        y,
        w,
        h,
        fontFace: "Aptos Display",
        fontSize: 30,
        color: TEXT,
        bold: true,
        margin: 0.05,
      },
      text,
    },
  };
}

function bodyPlaceholder(name, x, y, w, h, text = "Click to add text") {
  return {
    placeholder: {
      options: {
        name,
        type: "body",
        x,
        y,
        w,
        h,
        fontFace: "Aptos",
        fontSize: 18,
        color: TEXT,
        margin: 0.1,
        breakLine: false,
      },
      text,
    },
  };
}

function picturePlaceholder(name, x, y, w, h) {
  return {
    placeholder: {
      options: {
        name,
        type: "pic",
        x,
        y,
        w,
        h,
        margin: 0,
      },
      text: "",
    },
  };
}

function footerRule(y) {
  return {
    line: {
      x: 0.65,
      y,
      w: 12.05,
      h: 0,
      line: { color: "E5E7EB", width: 1 },
    },
  };
}

export function defineLabRatDefaultSlideMasters(pptx) {
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "en-US",
  };

  pptx.defineSlideMaster({
    title: "Title Slide",
    background: { color: WHITE },
    objects: [
      { rect: { x: 0, y: 0, w: 13.333333, h: 7.5, fill: { color: WHITE }, line: { color: WHITE } } },
      { line: { x: 0.85, y: 4.85, w: 2.2, h: 0, line: { color: ACCENT, width: 3 } } },
      titlePlaceholder(0.85, 2.55, 10.8, 0.85, "Click to add title"),
      bodyPlaceholder("subtitle", 0.9, 3.5, 9.6, 0.7, "Click to add subtitle"),
    ],
  });

  pptx.defineSlideMaster({
    title: "Title and Content",
    background: { color: WHITE },
    objects: [
      titlePlaceholder(0.65, 0.35, 12.1, 0.55),
      footerRule(1.08),
      bodyPlaceholder("content", 0.85, 1.45, 11.65, 5.35),
    ],
  });

  pptx.defineSlideMaster({
    title: "Section Header",
    background: { color: WHITE },
    objects: [
      { rect: { x: 0, y: 0, w: 13.333333, h: 7.5, fill: { color: "F8FAFC" }, line: { color: "F8FAFC" } } },
      { line: { x: 0.9, y: 2.15, w: 1.7, h: 0, line: { color: ACCENT, width: 3 } } },
      titlePlaceholder(0.9, 2.35, 10.7, 0.75),
      bodyPlaceholder("section-note", 0.95, 3.2, 9.5, 0.7, "Click to add section context"),
    ],
  });

  pptx.defineSlideMaster({
    title: "Two Content",
    background: { color: WHITE },
    objects: [
      titlePlaceholder(0.65, 0.35, 12.1, 0.55),
      footerRule(1.08),
      bodyPlaceholder("left-content", 0.8, 1.45, 5.65, 5.35),
      bodyPlaceholder("right-content", 6.9, 1.45, 5.65, 5.35),
    ],
  });

  pptx.defineSlideMaster({
    title: "Comparison",
    background: { color: WHITE },
    objects: [
      titlePlaceholder(0.65, 0.35, 12.1, 0.55),
      footerRule(1.08),
      bodyPlaceholder("left-heading", 0.8, 1.25, 5.65, 0.45, "Click to add heading"),
      bodyPlaceholder("right-heading", 6.9, 1.25, 5.65, 0.45, "Click to add heading"),
      bodyPlaceholder("left-content", 0.8, 1.85, 5.65, 4.95),
      bodyPlaceholder("right-content", 6.9, 1.85, 5.65, 4.95),
    ],
  });

  pptx.defineSlideMaster({
    title: "Title Only",
    background: { color: WHITE },
    objects: [
      titlePlaceholder(0.65, 0.35, 12.1, 0.55),
      footerRule(1.08),
    ],
  });

  pptx.defineSlideMaster({
    title: "Blank",
    background: { color: WHITE },
    objects: [],
  });

  pptx.defineSlideMaster({
    title: "Picture with Caption",
    background: { color: WHITE },
    objects: [
      titlePlaceholder(0.65, 0.35, 12.1, 0.55),
      picturePlaceholder("picture", 0.8, 1.3, 8.15, 5.55),
      bodyPlaceholder("caption", 9.25, 1.3, 3.25, 5.55, "Click to add caption"),
    ],
  });

  pptx.defineSlideMaster({
    title: LABRAT_FIGURE_MASTER,
    background: { color: WHITE },
    objects: [
      {
        text: {
          text: "LabRat",
          options: {
            x: 0.35,
            y: 7.1,
            w: 1.1,
            h: 0.18,
            fontFace: "Aptos",
            fontSize: 7,
            color: MUTED,
            margin: 0,
          },
        },
      },
    ],
  });
}
