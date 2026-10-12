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
from codemie_iac.envelope import Bundle, Document
from codemie_iac.resolver import ReferenceResolver, ReferenceResolutionError


def _integration_doc(name: str) -> Document:
    return Document.model_validate(
        {
            "version": "v1",
            "meta": {"kind": "integration", "name": name},
            "spec": {
                "project_name": "demo",
                "credential_type": "Jira",
                "credential_values": [
                    {"key": "api_token", "ref": "env:JIRA_PROD_API_TOKEN"}
                ],
            },
        }
    )


def test_resolve_unique_match():
    bundle = Bundle([_integration_doc("jira_prod")])
    doc = ReferenceResolver(bundle).resolve("integration", "jira_prod")
    assert doc.meta.name == "jira_prod"


def test_resolve_zero_matches_raises():
    with pytest.raises(ReferenceResolutionError, match="integration.*missing"):
        ReferenceResolver(Bundle([])).resolve("integration", "missing")


def test_resolve_ambiguous_raises():
    bundle = Bundle([_integration_doc("dup"), _integration_doc("dup")])
    with pytest.raises(ReferenceResolutionError, match="integration.*dup"):
        ReferenceResolver(bundle).resolve("integration", "dup")
