# Shadow qualification: anomalyco/opencode #33376

Source: https://github.com/anomalyco/opencode/issues/33376
Observed open on 2026-08-18.

The public issue is caused by model context-window overflow being misclassified as a network error. The required correction belongs to provider/session error classification and auto-compaction, not Zungun's network-reliability worker domain.
