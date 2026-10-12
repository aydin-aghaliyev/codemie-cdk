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

__version__ = "0.1.0"

from .envelope import Document, Bundle, DocumentMeta, DocumentKind
from .specs.assistant import AssistantSpec
from .specs.datasource import DatasourceSpec
from .specs.integration import IntegrationSpec
from .specs.skill import SkillSpec
from .specs.category import CategorySpec
from .specs.workflow import WorkflowSpec
from .credentials import CredentialRef
from .resolver import ReferenceResolver, ReferenceResolutionError
from .serializer import to_yaml, from_yaml, DocumentParseError
from .schema import document_json_schema, validate_document, DocumentValidationError

__all__ = [
    "Document",
    "Bundle",
    "DocumentMeta",
    "DocumentKind",
    "AssistantSpec",
    "DatasourceSpec",
    "IntegrationSpec",
    "SkillSpec",
    "CategorySpec",
    "WorkflowSpec",
    "CredentialRef",
    "ReferenceResolver",
    "ReferenceResolutionError",
    "to_yaml",
    "from_yaml",
    "DocumentParseError",
    "document_json_schema",
    "validate_document",
    "DocumentValidationError",
]
