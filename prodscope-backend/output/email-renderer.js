"use strict";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderStringList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p style="margin:8px 0 0;color:#6b7280;">None</p>';
  }

  return (
    '<ul style="margin:8px 0 0 18px;padding:0;color:#111827;">' +
    items.map((item) => `<li style="margin:6px 0;">${escapeHtml(item)}</li>`).join('') +
    '</ul>'
  );
}

function renderObjectList(items, type) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p style="margin:8px 0 0;color:#6b7280;">None</p>';
  }

  return items.map((item) => {
    if (typeof item === "string") {
      return `
        <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin:10px 0;background:#ffffff;">
          <div style="color:#111827;line-height:1.6;">${escapeHtml(item)}</div>
        </div>
      `;
    }

    const title =
      item.title ||
      item.category ||
      item.id ||
      (type === "critical" ? "Critical Issue" : "Item");

    const priority = item.priority ? `<span style="color:#2563eb;"> (${escapeHtml(item.priority)})</span>` : "";
    const severity = item.severity ? `<div style="margin-top:8px;font-size:12px;color:#6b7280;">Severity: ${escapeHtml(item.severity)}</div>` : "";
    const description = item.description ? `<div style="margin-top:8px;color:#374151;line-height:1.6;">${escapeHtml(item.description)}</div>` : "";
    const impact = item.impact ? `<div style="margin-top:8px;font-size:12px;color:#6b7280;">Impact: ${escapeHtml(item.impact)}</div>` : "";
    const innerItems = Array.isArray(item.items) ? renderStringList(item.items) : "";
    const recommendations = Array.isArray(item.recommendations) ? renderStringList(item.recommendations) : "";
    const issues = Array.isArray(item.issues) ? renderStringList(item.issues) : "";
    const fixes = Array.isArray(item.fixes) ? renderStringList(item.fixes) : "";

    const bg =
      type === "critical" ? "#fef2f2" :
      type === "suggestion" ? "#eff6ff" :
      type === "quickwin" ? "#f0fdf4" :
      "#ffffff";

    const border =
      type === "critical" ? "#fecaca" :
      type === "suggestion" ? "#bfdbfe" :
      type === "quickwin" ? "#bbf7d0" :
      "#e5e7eb";

    return `
      <div style="border:1px solid ${border};border-radius:12px;padding:14px 16px;margin:10px 0;background:${bg};">
        <div style="font-weight:700;color:#111827;">${escapeHtml(title)}${priority}</div>
        ${description}
        ${issues}
        ${recommendations}
        ${fixes}
        ${innerItems}
        ${impact}
        ${severity}
      </div>
    `;
  }).join('');
}

function renderReportEmail(reportText, analysesCount) {
  let report;
  const cleanedReportText = String(reportText || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    report = JSON.parse(cleanedReportText);
  } catch (e) {
    return `
      <div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:24px;background:#f9fafb;color:#111827;">
        <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;">
          <h1 style="margin:0 0 8px;font-size:28px;line-height:1.2;">Your ProdScope Analysis Report</h1>
          <p style="margin:0 0 16px;color:#4b5563;">${analysesCount} screens analyzed</p>
          <p style="margin:0 0 16px;color:#374151;line-height:1.6;">We could not format the report as structured sections, so the raw report is included below.</p>
          <div style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:12px;padding:16px;white-space:pre-wrap;font-family:monospace;font-size:13px;line-height:1.5;color:#111827;">${escapeHtml(cleanedReportText)}</div>
        </div>
      </div>
    `;
  }

  return `
    <div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:24px;background:#f9fafb;color:#111827;">
      <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:24px;">
        <h1 style="margin:0 0 8px;font-size:28px;line-height:1.2;">Your ProdScope Analysis Report</h1>
        <p style="margin:0 0 20px;color:#4b5563;">${analysesCount} screens analyzed</p>

        <div style="display:inline-block;background:#eef2ff;color:#4338ca;font-weight:700;border-radius:999px;padding:8px 14px;margin-bottom:18px;">
          Overall Score: ${escapeHtml(report.overall_score ?? "N/A")}/100
        </div>

        <div style="margin:0 0 24px;padding:16px;background:#f3f4f6;border-radius:12px;">
          <h2 style="margin:0 0 8px;font-size:18px;">Summary</h2>
          <div style="color:#374151;line-height:1.7;">${escapeHtml(report.summary || "No summary available.")}</div>
        </div>

        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;">Critical Bugs</h2>
          ${renderObjectList(report.critical_bugs || [], "critical")}
        </div>

        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;">UX Issues</h2>
          ${renderObjectList(report.ux_issues || [], "ux")}
        </div>

        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;">Suggestions</h2>
          ${renderObjectList(report.suggestions || [], "suggestion")}
        </div>

        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;">Quick Wins</h2>
          ${renderObjectList(report.quick_wins || [], "quickwin")}
        </div>

        <div style="margin:0 0 24px;">
          <h2 style="margin:0 0 10px;font-size:18px;">Detailed Findings</h2>
          ${renderObjectList(report.detailed_findings || [], "finding")}
        </div>

        <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">
          Generated by ProdScope automated app testing.
        </p>
      </div>
    </div>
  `;
}

module.exports = { renderReportEmail };
