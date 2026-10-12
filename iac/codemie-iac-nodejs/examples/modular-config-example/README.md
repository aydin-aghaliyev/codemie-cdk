# Modular Configuration Example

This example demonstrates how to organize a large Codemie IaC project using the `$import` directive for better maintainability and team collaboration.

## Structure

```
modular-config-example/
├── codemie.yaml                           # Main config (imports only)
├── configs/
│   ├── environment.yaml                   # Environment variables
│   ├── imported.yaml                      # Imported resources
│   ├── shared/
│   │   ├── tool-definitions.yaml         # Shared tool definitions
│   │   └── datasource-defaults.yaml      # Datasource defaults
│   ├── datasources/
│   │   ├── production-jira.yaml          # Individual critical resource
│   │   ├── production-confluence.yaml    # Individual critical resource
│   │   └── code-repos.yaml               # Array of code repositories
│   ├── assistants/
│   │   ├── ba-team.yaml                  # Array of BA team assistants
│   │   ├── dev-team.yaml                 # Array of dev team assistants
│   │   └── ceo-assistant.yaml            # Individual VIP assistant
│   └── workflows/
│       ├── test-automation.yaml          # Individual workflow
│       └── release-notes.yaml            # Individual workflow
└── (prompts and workflow definitions in parent directories)
```

## Key Features Demonstrated

### 1. **Object-Level Imports**
```yaml
# Import entire sections
environment:
  $import: configs/environment.yaml

tool_definitions:
  $import: configs/shared/tool-definitions.yaml
```

### 2. **Individual Resource Files**
```yaml
# One resource per file for critical resources
- $import: configs/datasources/production-jira.yaml
- $import: configs/assistants/ceo-assistant.yaml
```

### 3. **Array Files (Groups)**
```yaml
# Multiple resources in one file (grouped by team/type)
- $import: configs/datasources/code-repos.yaml       # 3 repos
- $import: configs/assistants/ba-team.yaml           # 2 assistants
```

### 4. **Mixed Approaches**
The example uses:
- Individual files for critical/unique resources
- Array files for similar resources (code repos, team assistants)
- Object imports for shared configurations

## Benefits of This Structure

### For Teams
- **BA Team** can edit `configs/assistants/ba-team.yaml` without conflicts
- **Dev Team** can edit `configs/assistants/dev-team.yaml` independently
- **DevOps** manages datasources separately

### For Git
- Minimal merge conflicts (each team works in separate files)
- Clear diffs (changes to one resource don't affect others)
- Easy code review (reviewers see only relevant files)

### For Maintenance
- Easy to find resources (file structure = resource structure)
- Shared configs prevent duplication (tool definitions, defaults)
- Clear dependencies (imports show what's needed)

## Usage

This example is for reference only. To use this structure in your project:

1. **Copy the structure**:
   ```bash
   mkdir -p configs/{shared,datasources,assistants,workflows}
   ```

2. **Start with monolithic config**, then gradually split:
   ```yaml
   # Step 1: Extract environment
   environment:
     $import: configs/environment.yaml
   
   # Step 2: Extract shared configs
   tool_definitions:
     $import: configs/shared/tool-definitions.yaml
   
   # Step 3: Extract resources
   resources:
     datasources:
       - $import: configs/datasources/all.yaml
   ```

3. **Split further as project grows**:
   - Individual files for frequently changed resources
   - Array files for stable groups
   - Keep related resources together

## Comparison with Monolithic

**Monolithic (before):**
```yaml
# codemie.yaml - 500+ lines
resources:
  datasources:
    - name: production-jira
      # 15 lines
    - name: production-confluence
      # 15 lines
    - name: frontend-app
      # 10 lines
    # ... 20 more datasources
  assistants:
    - name: BA Reviewer
      # 20 lines
    - name: BA Helper
      # 25 lines
    # ... 10 more assistants
```

**Modular (after):**
```yaml
# codemie.yaml - 30 lines (just imports)
resources:
  datasources:
    - $import: configs/datasources/production-jira.yaml
    - $import: configs/datasources/production-confluence.yaml
    - $import: configs/datasources/code-repos.yaml
  assistants:
    - $import: configs/assistants/ba-team.yaml
    - $import: configs/assistants/dev-team.yaml
```

## See Also

- [Configuration Organization](../../README.md#-configuration-organization) - Complete guide
- Main project `codemie.yaml` - Real-world example
- `examples/` directory - Other configuration examples
