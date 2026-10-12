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

"""Spec that narrows the nine ``codemie_sdk.models.datasource`` request classes
(subclasses of ``BaseDataSourceRequest``) for IaC documents.

Datasources authenticate via a referenced integration (``setting_id``, a
plain string naming/identifying an integration) rather than an inline
secret, so none of these classes needs ``CredentialRef`` narrowing.
``DatasourceSpec`` is a ``type``-discriminated union over the nine
per-kind ``*DatasourceSpec`` classes below.
"""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

from codemie_sdk.models.datasource import (
    AzureDevOpsWikiDataSourceRequest,
    AzureDevOpsWorkItemDataSourceRequest,
    BaseDataSourceRequest,
    CodeDataSourceRequest,
    ConfluenceDataSourceRequest,
    FileDataSourceRequest,
    GitFaqDataSourceRequest,
    GoogleDataSourceRequest,
    JiraDataSourceRequest,
    XWikiDataSourceRequest,
)


def _base_kwargs(request: BaseDataSourceRequest) -> dict:
    """Fields every ``*DatasourceSpec`` shares with its ``*DataSourceRequest``."""
    return {
        "name": request.name,
        "project_name": request.project_name,
        "description": request.description,
        "shared_with_project": request.shared_with_project,
        "setting_id": request.setting_id,
        "cron_expression": request.cron_expression,
        "timezone": request.timezone,
    }


class _DatasourceSpecBase(BaseModel):
    """Shared fields from ``BaseDataSourceRequest``."""

    model_config = ConfigDict(extra="forbid")

    name: str
    project_name: str
    description: str
    shared_with_project: bool = False
    setting_id: str | None = None
    cron_expression: str | None = None
    timezone: str | None = None


class CodeDatasourceSpec(_DatasourceSpecBase):
    """Narrows ``CodeDataSourceRequest`` (type=``code``)."""

    type: Literal["code"] = "code"
    link: str | None = None
    branch: str | None = None
    index_type: str | None = None
    files_filter: str | None = ""
    embeddings_model: str | None = None
    summarization_model: str | None = None
    prompt: str | None = None
    docs_generation: bool = False

    @classmethod
    def from_entity(cls, request: CodeDataSourceRequest) -> "CodeDatasourceSpec":
        return cls(
            **_base_kwargs(request),
            link=request.link,
            branch=request.branch,
            index_type=request.index_type,
            files_filter=request.files_filter,
            embeddings_model=request.embeddings_model,
            summarization_model=request.summarization_model,
            prompt=request.prompt,
            docs_generation=request.docs_generation,
        )


class GitFaqDatasourceSpec(_DatasourceSpecBase):
    """Narrows ``GitFaqDataSourceRequest`` (type=``knowledge_base_git_faq``)."""

    type: Literal["knowledge_base_git_faq"] = "knowledge_base_git_faq"
    link: str | None = None
    branch: str | None = None
    files_filter: str | None = None
    embedding_model: str | None = None

    @classmethod
    def from_entity(cls, request: GitFaqDataSourceRequest) -> "GitFaqDatasourceSpec":
        return cls(
            **_base_kwargs(request),
            link=request.link,
            branch=request.branch,
            files_filter=request.files_filter,
            embedding_model=request.embedding_model,
        )


class JiraDatasourceSpec(_DatasourceSpecBase):
    """Narrows ``JiraDataSourceRequest`` (type=``knowledge_base_jira``)."""

    type: Literal["knowledge_base_jira"] = "knowledge_base_jira"
    jql: str | None = None
    custom_fields: list[str] | None = None

    @classmethod
    def from_entity(cls, request: JiraDataSourceRequest) -> "JiraDatasourceSpec":
        return cls(
            **_base_kwargs(request),
            jql=request.jql,
            custom_fields=request.custom_fields,
        )


class ConfluenceDatasourceSpec(_DatasourceSpecBase):
    """Narrows ``ConfluenceDataSourceRequest`` (type=``knowledge_base_confluence``)."""

    type: Literal["knowledge_base_confluence"] = "knowledge_base_confluence"
    cql: str | None = None
    include_restricted_content: bool | None = None
    include_archived_content: bool | None = None
    include_attachments: bool | None = None
    include_comments: bool | None = None
    keep_markdown_format: bool | None = None
    keep_newlines: bool | None = None
    max_pages: int | None = None
    pages_per_request: int | None = None

    @classmethod
    def from_entity(
        cls, request: ConfluenceDataSourceRequest
    ) -> "ConfluenceDatasourceSpec":
        return cls(
            **_base_kwargs(request),
            cql=request.cql,
            include_restricted_content=request.include_restricted_content,
            include_archived_content=request.include_archived_content,
            include_attachments=request.include_attachments,
            include_comments=request.include_comments,
            keep_markdown_format=request.keep_markdown_format,
            keep_newlines=request.keep_newlines,
            max_pages=request.max_pages,
            pages_per_request=request.pages_per_request,
        )


class GoogleDatasourceSpec(_DatasourceSpecBase):
    """Narrows ``GoogleDataSourceRequest`` (type=``llm_routing_google``)."""

    type: Literal["llm_routing_google"] = "llm_routing_google"
    google_doc: str | None = None

    @classmethod
    def from_entity(cls, request: GoogleDataSourceRequest) -> "GoogleDatasourceSpec":
        return cls(**_base_kwargs(request), google_doc=request.google_doc)


class FileDatasourceSpec(_DatasourceSpecBase):
    """Narrows ``FileDataSourceRequest`` (type=``knowledge_base_file``).

    No extra fields beyond the base.
    """

    type: Literal["knowledge_base_file"] = "knowledge_base_file"

    @classmethod
    def from_entity(cls, request: FileDataSourceRequest) -> "FileDatasourceSpec":
        return cls(**_base_kwargs(request))


class AzureDevOpsWikiDatasourceSpec(_DatasourceSpecBase):
    """Narrows ``AzureDevOpsWikiDataSourceRequest`` (type=``knowledge_base_azure_devops_wiki``)."""

    type: Literal["knowledge_base_azure_devops_wiki"] = (
        "knowledge_base_azure_devops_wiki"
    )
    wiki_query: str | None = None
    organization: str | None = None
    project: str | None = None
    wiki_name: str | None = None

    @classmethod
    def from_entity(
        cls, request: AzureDevOpsWikiDataSourceRequest
    ) -> "AzureDevOpsWikiDatasourceSpec":
        return cls(
            **_base_kwargs(request),
            wiki_query=request.wiki_query,
            organization=request.organization,
            project=request.project,
            wiki_name=request.wiki_name,
        )


class AzureDevOpsWorkItemDatasourceSpec(_DatasourceSpecBase):
    """Narrows ``AzureDevOpsWorkItemDataSourceRequest`` (type=``knowledge_base_azure_devops_work_item``)."""

    type: Literal["knowledge_base_azure_devops_work_item"] = (
        "knowledge_base_azure_devops_work_item"
    )
    wiql_query: str | None = None
    organization: str | None = None
    project: str | None = None

    @classmethod
    def from_entity(
        cls, request: AzureDevOpsWorkItemDataSourceRequest
    ) -> "AzureDevOpsWorkItemDatasourceSpec":
        return cls(
            **_base_kwargs(request),
            wiql_query=request.wiql_query,
            organization=request.organization,
            project=request.project,
        )


class XWikiDatasourceSpec(_DatasourceSpecBase):
    """Narrows ``XWikiDataSourceRequest`` (type=``knowledge_base_xwiki``)."""

    type: Literal["knowledge_base_xwiki"] = "knowledge_base_xwiki"
    space: str | None = None
    wiki: str | None = None

    @classmethod
    def from_entity(cls, request: XWikiDataSourceRequest) -> "XWikiDatasourceSpec":
        return cls(**_base_kwargs(request), space=request.space, wiki=request.wiki)


DatasourceSpec = Annotated[
    Union[
        CodeDatasourceSpec,
        GitFaqDatasourceSpec,
        JiraDatasourceSpec,
        ConfluenceDatasourceSpec,
        GoogleDatasourceSpec,
        FileDatasourceSpec,
        AzureDevOpsWikiDatasourceSpec,
        AzureDevOpsWorkItemDatasourceSpec,
        XWikiDatasourceSpec,
    ],
    Field(discriminator="type"),
]
