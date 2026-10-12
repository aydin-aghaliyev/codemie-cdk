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

import yaml
from .envelope import Bundle, Document


class DocumentParseError(ValueError):
    """Raised when YAML text cannot even be parsed (invalid YAML syntax).

    Keeps ``from_yaml``'s public error contract consistent with
    ``DocumentValidationError``/``ReferenceResolutionError`` -- a caller
    should be able to catch one domain exception type for "this document
    could not be read" rather than also needing to know about the
    third-party ``yaml.YAMLError`` hierarchy (CR-006).
    """


def to_yaml(bundle: Bundle) -> str:
    # Not `exclude_none=True`: several fields default to something other than
    # `None` (e.g. WorkflowAssistant.limit_tool_output_tokens=10000,
    # SkillSpec.visibility="project"). Dropping an explicit `None` there would
    # have `from_yaml` reload it as that non-None default instead, breaking
    # the documented `from_yaml(to_yaml(b)) == b` round trip and making a
    # second dump of the reloaded bundle differ from the first.
    docs = [doc.model_dump(mode="json") for doc in bundle]
    return yaml.safe_dump_all(
        docs,
        sort_keys=False,
        default_flow_style=False,
        explicit_start=True,
        allow_unicode=True,
    )


def from_yaml(text: str) -> Bundle:
    try:
        raw_docs = list(yaml.safe_load_all(text))
    except yaml.YAMLError as exc:
        raise DocumentParseError(f"invalid YAML: {exc}") from exc
    # A trailing "---" with nothing after it parses as one extra `None`
    # entry at the very end -- a harmless artifact, not data loss. Drop
    # only that one; any other empty sub-document (CR-002) is a truncated
    # or malformed file and must not be silently discarded, the same
    # "nothing silently dropped" intent AC6 already enforces for a field.
    if raw_docs and raw_docs[-1] is None:
        raw_docs = raw_docs[:-1]
    for index, raw in enumerate(raw_docs):
        if raw is None:
            raise DocumentParseError(
                f"empty document at position {index} (not the trailing one)"
            )
    return Bundle([Document.model_validate(raw) for raw in raw_docs])
