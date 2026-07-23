import { blankTemplateLinks } from "../data/appMode.js";

export const BLANK_ONBOARDING_STEPS = [
  "Upload Excel workbook",
  "Review detected source regions",
  "Confirm region meaning",
  "Ask LabRat to select reviewed evidence",
  "Review the analysis plan and result",
  "Insert accepted charts into Manuscript",
];

export function BlankOnboarding({ onImportWorkbook, templateLinks = blankTemplateLinks() }) {
  return (
    <section className="blank-onboarding" aria-label="Blank project onboarding">
      <div className="blank-onboarding-head">
        <div>
          <h2>Start with your workbook</h2>
          <p>Blank mode starts with an empty project. Templates are examples only and are never imported automatically.</p>
        </div>
      </div>
      <ol className="blank-steps">
        {BLANK_ONBOARDING_STEPS.map((step) => <li key={step}>{step}</li>)}
      </ol>
      <div className="blank-template-panel">
        <h3>Example templates only</h3>
        <p>Use these files as formatting references, then upload your own workbook through Import workbook.</p>
        <div className="blank-template-links">
          {templateLinks.map((template) => (
            <a key={template.href} href={template.href} download>
              <span>{template.label}</span>
              <small>{template.note}</small>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
