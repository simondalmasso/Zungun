# Operational templates

## Mission

```yaml
schema_version: 1
mission_id: <ID>
objective: <verifiable outcome>
role: ARQ
repository: <owner/repo>
base_sha: <full SHA>
branch: <branch>
allowed_paths:
  - <path>
forbidden_paths:
  - <path>
acceptance_criteria:
  - <criterion>
required_tests:
  - <command or check>
required_artifacts:
  - <artifact>
release_permission: false
active_claim:
  claimed_by: <agent/session>
  claimed_at: <UTC>
  expires_at: <UTC>
  status: ACTIVE
```

## Checkpoint

```yaml
schema_version: 1
checkpoint_id: <ID>
mission_id: <ID>
repository: <owner/repo>
branch: <branch>
base_sha: <full SHA>
remote_sha: <full SHA>
changed_paths:
  - <path>
commits:
  - <full SHA>
tests:
  status: <PASS|FAIL>
  evidence:
    - <run/artifact/log>
ci_runs:
  - id: <run ID>
    status: completed
    conclusion: <success|failure>
artifacts:
  - id: <artifact ID>
    name: <name>
    provider_digest: <sha256>
    retention_until: <UTC>
    preserved_copy: <location|NONE>
    preserved_digest: <sha256|NONE>
known_risks: []
production_changed: false
next_role: AUD
```

## Audit

```yaml
schema_version: 1
audit_id: <ID>
mission_id: <ID>
audited_sha: <full SHA>
aud_context_id: <independent context/session>
arq_context_id: <context/session>
independent: true
evidence_reviewed:
  - <run, artifact, diff or report>
classification: <PASS|PASS_WITH_REMEDIATIONS|FAIL|BLOCKED>
findings:
  - id: <ID>
    severity: <critical|high|medium|low>
    evidence: <reference>
    required_outcome: <outcome>
remediation_order:
  required: false
  mission_id: <new ID|NONE>
  scope: <macro block|NONE>
  acceptance_criteria: []
release_authorized: false
```

## Human action

```yaml
schema_version: 1
status: WAITING_FOR_HUMAN_ACTION
action_id: <ID>
mission_id: <ID>
exact_action: <single concrete action>
allowed_count: 1
preconditions:
  - <condition>
prohibited_alternatives:
  - <alternative>
completion_evidence:
  - <evidence>
expires_at: <UTC>
```
