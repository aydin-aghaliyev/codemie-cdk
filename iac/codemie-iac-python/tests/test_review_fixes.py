# Copyright 2026 EPAM Systems, Inc. ("EPAM")
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Regression tests for code-review findings CR-001..CR-012.

Each test is named after the finding it closes, so a reviewer can map test
to finding directly without re-reading the full fix diff.
"""

import pytest
from pydantic import ValidationError

from codemie_sdk.builders.workflow.definition import WorkflowDefinition
from codemie_sdk.models.integration import CredentialTypes
from codemie_sdk.models.workflow import WorkflowMode

from codemie_iac.credentials import CredentialRef
from codemie_iac.envelope import Document
from codemie_iac.schema import DocumentValidationError, validate_document
from codemie_iac.serializer import DocumentParseError, from_yaml
from codemie_iac.specs.assistant import (
    AssistantSpec,
    MCPServerConfigSpec,
    MCPServerDetailsSpec,
    ToolDetailsSpec,
    ToolKitDetailsSpec,
)
from codemie_iac.specs.integration import CredentialRefEntry, IntegrationSpec
from codemie_iac.specs.workflow import WorkflowSpec


# CR-001: regex alone accepted any colon-shaped literal; the source prefix
# must now come from a known, closed set.
def test_cr001_rejects_unknown_source_prefix():
    with pytest.raises(ValidationError):
        CredentialRef("foo:abc_123_xyz")


def test_cr001_still_accepts_known_env_source():
    assert CredentialRef("env:SOME_REF").root == "env:SOME_REF"


# CR-002: sanitization collisions between distinct identifiers, and
# empty-after-sanitization inputs.
def test_cr002_rejects_empty_after_sanitization():
    with pytest.raises(ValueError):
        CredentialRef.from_entity("---", "***")


def test_cr002_detects_collision_across_distinct_identifiers():
    CredentialRef.from_entity("cr002_jira_prod", "api_token")
    with pytest.raises(ValueError, match="collision"):
        CredentialRef.from_entity("cr002_jira.prod", "api_token")


def test_cr002_same_pair_twice_is_not_a_collision():
    a = CredentialRef.from_entity("cr002_repeat", "api_token")
    b = CredentialRef.from_entity("cr002_repeat", "api_token")
    assert a == b


# CR-003: a non-dict `meta` must fail with a clean ValidationError, not an
# uncaught AttributeError.
def test_cr003_non_dict_meta_raises_validation_error():
    with pytest.raises(ValidationError):
        Document.model_validate(
            {"version": "v1", "meta": "oops", "spec": {"name": "x"}}
        )


# CR-004: validate_document must agree with Document.model_validate's
# kind-based dispatch, not the looser six-member anyOf.
def test_cr004_validate_document_is_kind_aware():
    # Satisfies CategorySpec's (looser) schema but meta.kind says "skill",
    # which requires description/content/project.
    bad = {
        "version": "v1",
        "meta": {"kind": "skill", "name": "x"},
        "spec": {"name": "x"},
    }
    with pytest.raises(DocumentValidationError):
        validate_document(bad)


def test_cr004_matches_document_model_validate_rejection():
    bad = {
        "version": "v1",
        "meta": {"kind": "skill", "name": "x"},
        "spec": {"name": "x"},
    }
    with pytest.raises(ValidationError):
        Document.model_validate(bad)
    with pytest.raises(DocumentValidationError):
        validate_document(bad)


# CR-005: every violation is collected, not just the first.
def test_cr005_reports_all_errors():
    bad = {"version": 123, "meta": {"kind": "skill"}, "spec": {}}
    with pytest.raises(DocumentValidationError) as exc:
        validate_document(bad)
    assert len(exc.value.errors) >= 3


# CR-006: invalid YAML syntax must raise a domain error, not a raw
# yaml.YAMLError.
def test_cr006_from_yaml_wraps_yaml_syntax_errors():
    with pytest.raises(DocumentParseError):
        from_yaml("version: v1\nmeta: [unclosed\n")


# CR-007: settings is narrowed (an integration name), not dropped.
def test_cr007_tool_details_settings_narrowed_not_dropped():
    tool = ToolDetailsSpec(name="t", settings="jira_prod")
    assert tool.settings == "jira_prod"


def test_cr007_toolkit_details_settings_narrowed_not_dropped():
    toolkit = ToolKitDetailsSpec(toolkit="tk", settings="jira_prod")
    assert toolkit.settings == "jira_prod"


def test_cr007_mcp_server_details_settings_narrowed_not_dropped():
    mcp = MCPServerDetailsSpec(name="m", enabled=True, settings="jira_prod")
    assert mcp.settings == "jira_prod"


# CR-008: env/headers accept a CredentialRef for secret-shaped values while
# keeping plain strings for non-secret entries, round-tripping correctly.
def test_cr008_env_and_headers_accept_credential_ref_and_plain_string():
    cfg = MCPServerConfigSpec(
        env={
            "API_KEY": CredentialRef.from_entity("cr008_svc", "api_key"),
            "DEBUG": "true",
        },
        headers={
            "Authorization": CredentialRef.from_entity("cr008_svc", "auth_header")
        },
    )
    assert isinstance(cfg.env["API_KEY"], CredentialRef)
    assert cfg.env["DEBUG"] == "true"
    assert isinstance(cfg.headers["Authorization"], CredentialRef)

    restored = MCPServerConfigSpec.model_validate(cfg.model_dump())
    assert restored == cfg
    assert isinstance(restored.env["API_KEY"], CredentialRef)
    assert restored.env["DEBUG"] == "true"


def test_cr008_rejects_literal_secret_value_disguised_as_plain_string_is_not_required():
    # A plain non-ref string is accepted as a plain string (not every env
    # value is a secret) -- this is the documented, intentional behavior.
    cfg = MCPServerConfigSpec(env={"MODE": "production"})
    assert cfg.env["MODE"] == "production"


# CR-009 (reopened): tools_tokens_size_limit is a genuine, user-settable,
# persisted field on both Assistant and MCPServerDetails (confirmed against
# the codemie backend -- rest_api/models/assistant.py's AssistantRequest and
# MCPServerDetails, assistant_version_service.py, and the
# add_tools_tokens_size_limit_to_assistants migration), NOT platform-computed
# as an earlier pass incorrectly assumed. It must be preserved on both
# AssistantSpec and MCPServerDetailsSpec, as a plain int -- it carries no
# credential material.
def test_cr009_assistant_spec_preserves_tools_tokens_size_limit():
    spec = AssistantSpec(
        name="a",
        description="d",
        system_prompt="s",
        project="p",
        llm_model_type="gpt",
        tools_tokens_size_limit=100,
    )
    assert spec.tools_tokens_size_limit == 100
    assert AssistantSpec.model_validate(spec.model_dump()) == spec


def test_cr009_mcp_server_details_spec_preserves_tools_tokens_size_limit():
    mcp = MCPServerDetailsSpec(name="m", enabled=True, tools_tokens_size_limit=50)
    assert mcp.tools_tokens_size_limit == 50
    assert MCPServerDetailsSpec.model_validate(mcp.model_dump()) == mcp


# CR-010: duplicate credential_values keys are rejected.
def test_cr010_integration_rejects_duplicate_credential_keys():
    with pytest.raises(ValidationError, match="duplicate"):
        IntegrationSpec(
            project_name="demo",
            credential_type=CredentialTypes.JIRA,
            credential_values=[
                CredentialRefEntry(
                    key="api_token",
                    ref=CredentialRef.from_entity("cr010_a", "api_token"),
                ),
                CredentialRefEntry(
                    key="api_token",
                    ref=CredentialRef.from_entity("cr010_b", "api_token"),
                ),
            ],
        )


def test_cr010_integration_allows_distinct_credential_keys():
    spec = IntegrationSpec(
        project_name="demo",
        credential_type=CredentialTypes.JIRA,
        credential_values=[
            CredentialRefEntry(
                key="api_token",
                ref=CredentialRef.from_entity("cr010_c", "api_token"),
            ),
            CredentialRefEntry(
                key="api_user",
                ref=CredentialRef.from_entity("cr010_c", "api_user"),
            ),
        ],
    )
    assert len(spec.credential_values) == 2


# CR-011: WorkflowSpec preserves icon_url. Originally fixed by carrying
# icon_url on a sibling field of a file-pointer WorkflowSpec; superseded by
# the single-file redesign (WorkflowSpec wraps WorkflowDefinition directly),
# which makes this hold structurally -- icon_url has no separate path to be
# dropped from, since it's just read off the embedded definition.
def test_cr011_workflow_spec_preserves_icon_url():
    workflow = WorkflowDefinition(
        name="wf-cr011",
        mode=WorkflowMode.SEQUENTIAL,
        icon_url="https://example.com/icon.png",
    )
    spec = WorkflowSpec(workflow=workflow)
    assert spec.workflow.icon_url == "https://example.com/icon.png"
    assert WorkflowSpec.model_validate(spec.model_dump()) == spec


# CR-012 (write_workflow_definition's parent-dir creation / overwrite guard)
# no longer applies: the single-file WorkflowSpec redesign removed the file
# write entirely, so the scenario it guarded against can't happen anymore.
