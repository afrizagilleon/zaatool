Analyze this file for SOLID violations adapted for React/TypeScript:

File: $ARGUMENTS

Check each principle:

**S - Single Responsibility**
- Does each component render ONE thing?
- Does each custom hook do ONE job?
- Are data fetching, UI, and business logic separated?

**O - Open/Closed**
- Is the component extensible via props without modifying internals?
- Are there hardcoded conditionals that should be composition?

**L - Liskov Substitution**
- Do custom components honor the contract of their HTML base?
- Do TypeScript types properly extend without breaking?

**I - Interface Segregation**  
- Are prop interfaces minimal and focused?
- Are there props passed down that the component doesn't use (prop drilling)?

**D - Dependency Inversion**
- Is data fetching abstracted into hooks?
- Does the component depend on concrete implementations or interfaces?

Output format:
---
## [PRINCIPLE VIOLATED]: [Short Title]
**File**: [filename]  
**Line**: [line number]  
**Problem**: [explanation]  
**Suggestion**: [refactored snippet]
---

DO NOT make any changes. Analysis only. Wait for my confirmation.
