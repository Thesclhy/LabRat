import { blankTemplateLinks } from "../data/appMode.js";

export const BLANK_ONBOARDING_STEPS = [
  "Upload Excel workbook",
  "Scan workbook",
  "Review detected tables/blocks",
  "Approve or ignore blocks",
  "Preview normalized data",
  "Apply to project",
  "Generate semantic mappings",
  "Generate chart proposals",
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
