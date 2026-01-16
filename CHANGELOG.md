# Changelog

All notable changes to the "GitHub Projects" extension will be documented in this file.

## [0.1.0] - 2025-01-15

### Added
- View GitHub Project boards directly in VS Code sidebar
- Mirrors your project views (Board, Table, Roadmap) exactly as configured on GitHub
- Auto-detect repository from git remote
- **Start Working** workflow:
  - Creates feature branches with configurable naming pattern
  - Checks git status before branch creation (uncommitted changes, behind origin)
  - Automatically moves issues to configured status
- **Planning Board** webview for visual project management
- Create new issues with template support
- Configure default issue template
- Link branches to issues
- Switch to linked branches directly from sidebar
- Move items between statuses
- Filter to show only items assigned to you
- Hide specific views from sidebar
- Show/hide empty columns
- Configurable status transitions for PR opened/merged events

### Configuration Options
- `ghProjects.mainBranch` - Main branch name (default: "main")
- `ghProjects.branchNamePattern` - Pattern for new branches
- `ghProjects.startWorkingStatus` - Status when starting work
- `ghProjects.prOpenedStatus` - Status when PR is opened
- `ghProjects.prMergedStatus` - Status when PR is merged
- `ghProjects.showOnlyAssignedToMe` - Filter to your items
- `ghProjects.hiddenViews` - Views to hide
- `ghProjects.showEmptyColumns` - Show empty status columns
- `ghProjects.defaultIssueTemplate` - Default template for new issues
- `ghProjects.allowBlankIssues` - Allow creating blank issues
