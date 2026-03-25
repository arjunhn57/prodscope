"use strict";

/**
 * report-builder.js — Structured JSON report with 1 Sonnet LLM call
 *
 * Replaces the old generateReport() that concatenated all per-screen
 * analyses into one big prompt. Now uses compressed context from
 * context-builder.js and produces a structured report matching
 * CLAUDE.md Section 8 schema.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { REPORT_MODEL } = require("../config/defaults");
const { buildReportPrompt } = require("../brain/context-builder");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Build a structured report from crawl results + oracle findings.
 * Makes 1 Sonnet LLM call for synthesis.
 *
 * @param {Object} params
 * @param {string} params.packageName
 * @param {Object} params.coverageSummary - From coverageTracker.summary()
 * @param {Array}  params.deterministicFindings - Crash, ANR, UX findings
 * @param {Array}  params.aiAnalyses - AI oracle results on triaged screens
 * @param {Array}  params.flows - Completed flows from flow tracker
 * @param {Object} params.crawlStats - { totalSteps, uniqueStates, stopReason }
 * @param {Object} params.opts - { goals, painPoints, goldenPath, email }
 * @param {Object} params.crawlHealth - { emulatorRestarts, stuckRecoveries, etc. }
 * @returns {{ report: string, tokenUsage: { input_tokens: number, output_tokens: number } }}
 */
async function buildReport(params) {
  const {
    packageName,
    coverageSummary,
    deterministicFindings,
    aiAnalyses,
    flows,
    crawlStats,
    opts,
    crawlHealth,
  } = params;

  // Build compressed prompt (~3000 tokens)
  const prompt = buildReportPrompt({
    packageName,
    coverageSummary,
    deterministic: deterministicFindings,
    aiFindings: aiAnalyses,
    flows,
    crawlStats,
    opts,
  });

  try {
    const response = await anthropic.messages.create({
      model: REPORT_MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].text;
    const tokenUsage = {
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
    };

    // Try to parse and enrich with structured data
    let reportJson;
    try {
      const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      reportJson = JSON.parse(cleaned);
    } catch (e) {
      // If LLM didn't return valid JSON, wrap it
      reportJson = {
        overall_score: 0,
        summary: raw.substring(0, 2000),
        critical_bugs: [],
        ux_issues: [],
        suggestions: [],
        quick_wins: [],
        recommended_next_steps: [],
        coverage_assessment: "Unable to parse structured report",
      };
    }

    // Enrich with structured data that doesn't need LLM
    reportJson.coverage = {
      summary: coverageSummary,
      totalFlows: (flows || []).length,
      completedFlows: (flows || []).filter((f) => f.outcome === "completed").length,
    };

    reportJson.crawl_health = crawlHealth || {};
    reportJson.crawl_stats = crawlStats;

    // Add deterministic findings as structured data
    reportJson.deterministic_findings = (deterministicFindings || []).map((f) => ({
      type: f.type,
      severity: f.severity,
      detail: f.detail,
      step: f.step,
      element: f.element,
    }));

    reportJson.token_usage = tokenUsage;

    const reportText = JSON.stringify(reportJson, null, 2);
    return { report: reportText, tokenUsage };
  } catch (e) {
    console.error(`  [report-builder] Report generation failed: ${e.message}`);

    // Fallback: build deterministic-only report (no LLM)
    const fallbackReport = {
      overall_score: 0,
      summary: `Report generation failed: ${e.message}. Deterministic findings are included below.`,
      critical_bugs: (deterministicFindings || [])
        .filter((f) => f.severity === "critical" || f.type === "crash")
        .map((f) => ({ title: f.type, description: f.detail })),
      ux_issues: (deterministicFindings || [])
        .filter((f) => f.type.includes("accessibility") || f.type === "empty_screen")
        .map((f) => ({ title: f.type, description: f.detail })),
      suggestions: [],
      quick_wins: [],
      coverage: { summary: coverageSummary },
      crawl_stats: crawlStats,
      deterministic_findings: deterministicFindings || [],
      ai_analysis_failed: true,
    };

    return {
      report: JSON.stringify(fallbackReport, null, 2),
      tokenUsage: { input_tokens: 0, output_tokens: 0 },
    };
  }
}

module.exports = { buildReport };
