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
from pydantic import TypeAdapter, ValidationError

from codemie_sdk.models.datasource import (
    AzureDevOpsWikiDataSourceRequest,
    AzureDevOpsWorkItemDataSourceRequest,
    CodeDataSourceRequest,
    ConfluenceDataSourceRequest,
    FileDataSourceRequest,
    GitFaqDataSourceRequest,
    GoogleDataSourceRequest,
    JiraDataSourceRequest,
    XWikiDataSourceRequest,
)

from codemie_iac.specs.datasource import (
    AzureDevOpsWikiDatasourceSpec,
    AzureDevOpsWorkItemDatasourceSpec,
    CodeDatasourceSpec,
    ConfluenceDatasourceSpec,
    DatasourceSpec,
    FileDatasourceSpec,
    GitFaqDatasourceSpec,
    GoogleDatasourceSpec,
    JiraDatasourceSpec,
    XWikiDatasourceSpec,
)

_adapter = TypeAdapter(DatasourceSpec)


def test_roundtrip_code():
    spec = CodeDatasourceSpec(
        name="code_ds",
        project_name="proj1",
        description="Code datasource",
        shared_with_project=True,
        setting_id="int-123",
        cron_expression="0 0 * * *",
        timezone="UTC",
        type="code",
        link="https://github.com/org/repo",
        branch="main",
        index_type="code",
        files_filter="*.py",
        embeddings_model="text-embedding-3-small",
        summarization_model="gpt-4o",
        prompt="Summarize the code",
        docs_generation=True,
    )
    dumped = spec.model_dump()
    assert _adapter.validate_python(dumped) == spec


def test_roundtrip_git_faq():
    spec = GitFaqDatasourceSpec(
        name="git_faq_ds",
        project_name="proj1",
        description="Git FAQ datasource",
        shared_with_project=False,
        setting_id="int-456",
        cron_expression=None,
        timezone="UTC",
        type="knowledge_base_git_faq",
        link="https://github.com/org/repo",
        branch="main",
        files_filter="*.md",
        embedding_model="text-embedding-3-small",
    )
    dumped = spec.model_dump()
    assert _adapter.validate_python(dumped) == spec


def test_roundtrip_jira():
    spec = JiraDatasourceSpec(
        name="jira_ds",
        project_name="proj1",
        description="Jira datasource",
        shared_with_project=True,
        setting_id="int-789",
        type="knowledge_base_jira",
        jql="project = ABC",
        custom_fields=["customfield_100", "customfield_200"],
    )
    dumped = spec.model_dump()
    assert _adapter.validate_python(dumped) == spec


def test_roundtrip_confluence():
    spec = ConfluenceDatasourceSpec(
        name="confluence_ds",
        project_name="proj1",
        description="Confluence datasource",
        shared_with_project=False,
        setting_id="int-321",
        type="knowledge_base_confluence",
        cql="space = DEV",
        include_restricted_content=False,
        include_archived_content=True,
        include_attachments=True,
        include_comments=False,
        keep_markdown_format=True,
        keep_newlines=False,
        max_pages=100,
        pages_per_request=25,
    )
    dumped = spec.model_dump()
    assert _adapter.validate_python(dumped) == spec


def test_roundtrip_google():
    spec = GoogleDatasourceSpec(
        name="google_ds",
        project_name="proj1",
        description="Google docs datasource",
        shared_with_project=True,
        setting_id="int-654",
        type="llm_routing_google",
        google_doc="https://docs.google.com/document/d/abc123",
    )
    dumped = spec.model_dump()
    assert _adapter.validate_python(dumped) == spec


def test_roundtrip_file():
    spec = FileDatasourceSpec(
        name="file_ds",
        project_name="proj1",
        description="File datasource",
        shared_with_project=False,
        setting_id=None,
        type="knowledge_base_file",
    )
    dumped = spec.model_dump()
    assert _adapter.validate_python(dumped) == spec


def test_roundtrip_azure_devops_wiki():
    spec = AzureDevOpsWikiDatasourceSpec(
        name="ado_wiki_ds",
        project_name="proj1",
        description="Azure DevOps Wiki datasource",
        shared_with_project=True,
        setting_id="int-987",
        type="knowledge_base_azure_devops_wiki",
        wiki_query="path:Home",
        organization="my-org",
        project="my-project",
        wiki_name="MyWiki",
    )
    dumped = spec.model_dump()
    assert _adapter.validate_python(dumped) == spec


def test_roundtrip_azure_devops_work_item():
    spec = AzureDevOpsWorkItemDatasourceSpec(
        name="ado_wi_ds",
        project_name="proj1",
        description="Azure DevOps Work Item datasource",
        shared_with_project=False,
        setting_id="int-111",
        type="knowledge_base_azure_devops_work_item",
        wiql_query="SELECT * FROM WorkItems",
        organization="my-org",
        project="my-project",
    )
    dumped = spec.model_dump()
    assert _adapter.validate_python(dumped) == spec


def test_roundtrip_xwiki():
    spec = XWikiDatasourceSpec(
        name="xwiki_ds",
        project_name="proj1",
        description="xWiki datasource",
        shared_with_project=True,
        setting_id="int-222",
        type="knowledge_base_xwiki",
        space="Main",
        wiki="xwiki",
    )
    dumped = spec.model_dump()
    assert _adapter.validate_python(dumped) == spec


def test_unknown_type_rejected():
    with pytest.raises(ValidationError):
        _adapter.validate_python(
            {"type": "not_a_real_type", "name": "x", "description": "d"}
        )


def test_code_spec_from_entity():
    request = CodeDataSourceRequest(
        name="my_code_kb",
        project_name="my-project",
        description="Code knowledge base",
        link="https://github.com/org/repo",
        branch="main",
    )
    spec = CodeDatasourceSpec.from_entity(request)
    assert spec == CodeDatasourceSpec(
        name=request.name,
        project_name=request.project_name,
        description=request.description,
        shared_with_project=request.shared_with_project,
        setting_id=request.setting_id,
        cron_expression=request.cron_expression,
        timezone=request.timezone,
        link=request.link,
        branch=request.branch,
        index_type=request.index_type,
        files_filter=request.files_filter,
        embeddings_model=request.embeddings_model,
        summarization_model=request.summarization_model,
        prompt=request.prompt,
        docs_generation=request.docs_generation,
    )


def test_git_faq_spec_from_entity():
    request = GitFaqDataSourceRequest(
        name="git_faq_kb",
        project_name="my-project",
        description="Git FAQ knowledge base",
        link="https://github.com/org/repo",
        branch="main",
    )
    spec = GitFaqDatasourceSpec.from_entity(request)
    assert spec.link == request.link
    assert spec.embedding_model == request.embedding_model


def test_jira_spec_from_entity():
    request = JiraDataSourceRequest(
        name="jira_kb",
        project_name="my-project",
        description="Jira knowledge base",
        jql="project = PROJ",
        setting_id="jira-prod",
    )
    spec = JiraDatasourceSpec.from_entity(request)
    assert spec.jql == request.jql
    assert spec.setting_id == "jira-prod"


def test_confluence_spec_from_entity():
    request = ConfluenceDataSourceRequest(
        name="confluence_kb",
        project_name="my-project",
        description="Confluence knowledge base",
        cql="space = DEV",
    )
    spec = ConfluenceDatasourceSpec.from_entity(request)
    assert spec.cql == request.cql


def test_google_spec_from_entity():
    request = GoogleDataSourceRequest(
        name="google_kb",
        project_name="my-project",
        description="Google docs knowledge base",
        google_doc="https://docs.google.com/document/d/abc123",
    )
    spec = GoogleDatasourceSpec.from_entity(request)
    assert spec.google_doc == request.google_doc


def test_file_spec_from_entity():
    request = FileDataSourceRequest(
        name="file_kb", project_name="my-project", description="File knowledge base"
    )
    spec = FileDatasourceSpec.from_entity(request)
    assert spec.name == request.name


def test_azure_devops_wiki_spec_from_entity():
    request = AzureDevOpsWikiDataSourceRequest(
        name="ado_wiki_kb",
        project_name="my-project",
        description="Azure DevOps wiki knowledge base",
        wiki_query="path:Home",
        organization="my-org",
        project="my-project",
        wiki_name="MyWiki",
    )
    spec = AzureDevOpsWikiDatasourceSpec.from_entity(request)
    assert spec.wiki_name == request.wiki_name


def test_azure_devops_work_item_spec_from_entity():
    request = AzureDevOpsWorkItemDataSourceRequest(
        name="ado_wi_kb",
        project_name="my-project",
        description="Azure DevOps work item knowledge base",
        wiql_query="SELECT * FROM WorkItems",
        organization="my-org",
        project="my-project",
    )
    spec = AzureDevOpsWorkItemDatasourceSpec.from_entity(request)
    assert spec.wiql_query == request.wiql_query


def test_xwiki_spec_from_entity():
    request = XWikiDataSourceRequest(
        name="xwiki_kb",
        project_name="my-project",
        description="xWiki knowledge base",
        space="Main",
        wiki="xwiki",
    )
    spec = XWikiDatasourceSpec.from_entity(request)
    assert spec.space == request.space
    assert spec.wiki == request.wiki
