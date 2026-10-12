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

"""JSON Schema generation and offline validation for IaC documents."""

import jsonschema
from pydantic import TypeAdapter

from .envelope import Document, _SPEC_BY_KIND


def document_json_schema() -> dict:
    """Return the JSON Schema for Document derived from the Pydantic model."""
    return Document.model_json_schema()


class DocumentValidationError(ValueError):
    """Raised when a document fails JSON Schema validation.

    ``json_path``/``message`` describe the first violation found. jsonschema
    can report more than one problem per document (CR-005); every violation
    found during this call, formatted the same way, is available via
    ``errors`` so a caller does not have to fix-and-rerun to discover a
    second, previously-hidden one.
    """

    def __init__(self, json_path: str, message: str, errors: list[str] | None = None):
        all_errors = errors if errors is not None else [f"{json_path}: {message}"]
        suffix = (
            f" ({len(all_errors)} total validation errors)"
            if len(all_errors) > 1
            else ""
        )
        super().__init__(f"{json_path}: {message}{suffix}")
        self.json_path = json_path
        self.message = message
        self.errors = all_errors


def _prefix_json_path(json_path: str, prefix: str) -> str:
    """Rewrite a jsonschema ``$``-rooted path (e.g. ``$.name``) under ``prefix``."""
    if json_path == "$":
        return f"$.{prefix}"
    return f"$.{prefix}.{json_path[2:]}"


def validate_document(data: dict) -> None:
    """Validate a dictionary against the Document JSON Schema, fully offline.

    First validates ``data`` against the overall ``Document`` schema (shared
    structure: ``version``/``meta``/``spec`` as a six-member ``anyOf``).
    When ``meta.kind`` is present and recognized, ``spec`` is additionally,
    separately validated against that *specific* Spec class's own schema --
    reusing the same ``_SPEC_BY_KIND`` mapping ``Document``'s own
    kind-dispatch validator uses (CR-004). Without this second pass, a
    ``spec`` payload that happens to satisfy a looser *different* kind's
    schema (e.g. a `skill` spec missing required fields that nonetheless
    satisfies `CategorySpec`'s schema) would pass here while still being
    rejected by ``Document.model_validate``/``from_yaml``, defeating the
    offline pre-flight-check guarantee this function exists to provide.

    Raises DocumentValidationError naming the first offending JSON path;
    every violation found this call is available via the raised error's
    ``errors`` attribute.
    """
    validator = jsonschema.Draft202012Validator(document_json_schema())
    errors = list(validator.iter_errors(data))
    if errors:
        formatted = [f"{error.json_path}: {error.message}" for error in errors]
        raise DocumentValidationError(
            errors[0].json_path, errors[0].message, errors=formatted
        )

    if not isinstance(data, dict):
        return
    meta = data.get("meta")
    kind = meta.get("kind") if isinstance(meta, dict) else None
    spec_cls = _SPEC_BY_KIND.get(kind) if kind is not None else None
    spec_data = data.get("spec")
    if spec_cls is None or not isinstance(spec_data, dict):
        return

    spec_validator = jsonschema.Draft202012Validator(
        TypeAdapter(spec_cls).json_schema()
    )
    spec_errors = list(spec_validator.iter_errors(spec_data))
    if spec_errors:
        formatted = [
            f"{_prefix_json_path(error.json_path, 'spec')}: {error.message}"
            for error in spec_errors
        ]
        first = spec_errors[0]
        raise DocumentValidationError(
            _prefix_json_path(first.json_path, "spec"), first.message, errors=formatted
        )
