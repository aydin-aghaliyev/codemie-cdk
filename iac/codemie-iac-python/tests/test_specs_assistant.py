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

import pytest
from pydantic import ValidationError

from codemie_sdk.models.assistant import (
    AssistantCreateRequest,
    Integration,
    MCPServerConfig,
    MCPServerDetails,
    ToolDetails,
    ToolKitDetails,
)
from codemie_sdk.models.integration import CredentialTypes

from codemie_iac.credentials import CredentialRef
from codemie_iac.specs.assistant import (
    AssistantSpec,
    MCPServerConfigSpec,
    MCPServerDetailsSpec,
)


def test_roundtrip_assistant_with_mcp_server():
    spec = AssistantSpec(
        name="jira-assistant",
        description="Assistant that helps with Jira",
        system_prompt="You are a helpful Jira assistant.",
        project="proj1",
        llm_model_type="gpt-4o",
        mcp_servers=[
            MCPServerDetailsSpec(
                name="jira-mcp",
                description=None,
                enabled=True,
                config=MCPServerConfigSpec(
                    auth_token=CredentialRef.from_entity("jira_prod", "api_token")
                ),
                mcp_connect_auth_token="jira_prod",
            )
        ],
    )
    dumped = spec.model_dump()
    assert AssistantSpec.model_validate(dumped) == spec


def test_rejects_literal_auth_token():
    with pytest.raises(ValidationError):
        MCPServerConfigSpec(auth_token="plaintext-secret")


def test_assistant_spec_from_entity_narrows_integration_references():
    jira_integration = Integration(
        project_name="my-project",
        alias="jira-prod",
        credential_type=CredentialTypes.JIRA,
        credential_values=[],
    )
    request = AssistantCreateRequest(
        name="release-notes-writer",
        description="Writes release notes from merged PRs",
        system_prompt="You write concise, user-facing release notes.",
        project="my-project",
        llm_model_type="gpt-4o",
        toolkits=[
            ToolKitDetails(
                toolkit="jira",
                tools=[ToolDetails(name="jira_search", settings=jira_integration)],
                settings=jira_integration,
            )
        ],
        mcp_servers=[
            MCPServerDetails(
                name="jira-mcp",
                description=None,
                enabled=True,
                config=MCPServerConfig(command="npx", auth_token="a-real-secret"),
                mcp_connect_auth_token=jira_integration,
            )
        ],
    )

    spec = AssistantSpec.from_entity(request)

    assert spec.toolkits[0].settings == "jira-prod"
    assert spec.toolkits[0].tools[0].settings == "jira-prod"
    assert spec.mcp_servers[0].mcp_connect_auth_token == "jira-prod"
    assert spec.mcp_servers[0].config.auth_token == CredentialRef.from_entity(
        "release-notes-writer_jira-mcp", "auth_token"
    )
    # round-trips cleanly once narrowed
    assert AssistantSpec.model_validate(spec.model_dump()) == spec


def test_assistant_spec_from_entity_passes_env_values_through_unchanged():
    request = AssistantCreateRequest(
        name="a",
        description="d",
        system_prompt="p",
        project="proj",
        llm_model_type="gpt-4o",
        mcp_servers=[
            MCPServerDetails(
                name="server",
                description=None,
                enabled=True,
                config=MCPServerConfig(
                    command="npx", env={"DEBUG": "true", "TOKEN": "env:MY_REF"}
                ),
            )
        ],
    )

    spec = AssistantSpec.from_entity(request)

    assert spec.mcp_servers[0].config.env["DEBUG"] == "true"
    assert spec.mcp_servers[0].config.env["TOKEN"] == CredentialRef("env:MY_REF")


def test_mcp_server_config_narrows_url_and_args_when_reference_shaped():
    """Regression: `url`/`args` had no narrowing at all (unlike `env`/
    `headers`), so a reference placed in either of them stayed a plain
    string instead of round-tripping as a CredentialRef like it does
    everywhere else this convention applies."""
    config = MCPServerConfigSpec(
        url="env:MCP_URL_REF", args=["--flag", "env:MCP_ARG_REF"]
    )
    assert config.url == CredentialRef("env:MCP_URL_REF")
    assert config.args[0] == "--flag"
    assert config.args[1] == CredentialRef("env:MCP_ARG_REF")


def test_mcp_server_config_leaves_non_reference_url_and_args_as_plain_text():
    """Documents the limit of that narrowing: it is a whole-value match
    only. A secret embedded inside a larger string (e.g. a CLI flag) is not
    detected and is kept as plain text -- this is the explicitly documented
    trade-off (module docstring / README), not a silent gap."""
    config = MCPServerConfigSpec(
        url="https://example.com?token=not-a-reference",
        args=["--token=also-not-a-reference"],
    )
    assert config.url == "https://example.com?token=not-a-reference"
    assert config.args == ["--token=also-not-a-reference"]


def test_mcp_server_details_narrows_arguments_and_mcp_connect_url():
    details = MCPServerDetailsSpec(
        name="m",
        enabled=True,
        arguments="env:MCP_ARGUMENTS_REF",
        mcp_connect_url="env:MCP_CONNECT_URL_REF",
    )
    assert details.arguments == CredentialRef("env:MCP_ARGUMENTS_REF")
    assert details.mcp_connect_url == CredentialRef("env:MCP_CONNECT_URL_REF")


def test_assistant_rejects_unknown_field():
    with pytest.raises(ValidationError, match="extra"):
        AssistantSpec(
            name="jira-assistant",
            description="Assistant that helps with Jira",
            system_prompt="You are a helpful Jira assistant.",
            project="proj1",
            llm_model_type="gpt-4o",
            not_a_real_field="oops",
        )
