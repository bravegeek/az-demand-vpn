
### 🔄 Project Awareness & Context
- **Always read `PLANNING.md`** at the start of a new
conversation to understand the project's architecture, goals,
style, and constraints.
- **For technical architecture and system design**, refer to [technical_design_document.md](./technical_design_document.md).
- **Check `TASK.md`** before starting a new task. If the task
isn’t listed, add it with a brief description and today's date.
- **Use consistent naming conventions, file structure, and
architecture patterns** as described in `PLANNING.md`.

### 🧱 Code Structure & Modularity
- **Never create a file longer than 500 lines of code.** If a
file approaches this limit, refactor by splitting it into modules
or helper files.
- **Organize code into clearly separated modules**, grouped by
feature or responsibility.
- **Use clear, consistent imports** (prefer relative imports
within packages).

### 🧪 Testing & Reliability
- **Always create Jest unit tests for new features**
(functions, classes, routes, etc).
- **After updating any logic**, check whether existing unit tests
need to be updated. If so, do it.
- **Tests should live in a `/tests` folder** mirroring the main
app structure.
- Include at least:
- 1 test for expected use
- 1 edge case
- 1 failure case

### ✅ Task Completion
- **Mark completed tasks in `TASK.md`** immediately after
finishing them.
- Add new sub-tasks or TODOs discovered during development to
`TASK.md` under a “Discovered During Work” section.

### 📎 Style & Conventions
- **Use JavaScript** as the primary language.

### 🚀 JavaScript Conventions

#### Code Style
- Follow **Airbnb JavaScript Style Guide**
- Use **2-space indentation**
- Use **single quotes** for strings (except when using template literals)
- Be consistent with **semicolon** usage

#### Naming Conventions
- `PascalCase` for classes and constructors
- `camelCase` for variables, functions, and methods
- `UPPER_SNAKE_CASE` for constants
- Prefix private members with `_`

#### ES6+ Features
- Prefer `const` and `let` over `var`
- Use arrow functions for callbacks
- Use template literals for string interpolation
- Use destructuring when appropriate

#### Game-Specific Conventions
- Use classes for game entities (Meteor, Player, etc.)
- Follow the Entity-Component-System (ECS) pattern as defined in the technical design
- Keep game loop logic clean and efficient

#### File Structure
```
TODO

#### Documentation
- Use JSDoc for all functions and classes
- Document parameters, return values, and types
- Include examples for complex functions

#### Error Handling
- Use try/catch for expected errors
- Validate function parameters
- Provide meaningful error messages

#### Testing
- Write unit tests for core logic
- Use descriptive test names
- Follow AAA pattern: Arrange, Act, Assert

#### Recommended Tools
- **ESLint** - For code linting
- **Prettier** - For code formatting
- **Jest** - For testing
- **JSDoc** - For documentation

### 📚 Documentation & Explainability
- **Update `README.md`** when new features are added,
dependencies change, or setup steps are modified.
- **Comment non-obvious code** and ensure everything is
understandable to a mid-level developer.
- When writing complex logic, **add an inline `# Reason:`
comment** explaining the why, not just the what.

### 🧠 AI Behavior Rules
- **Never assume missing context. Ask questions if uncertain.**
- **Never hallucinate libraries or functions** – only use known,
verified Python packages.
- **Always confirm file paths and module names** exist before
referencing them in code or tests.
- **Never delete or overwrite existing code** unless explicitly
instructed to or if part of a task from `TASK.md`.