# Contributing to ForMash 3D

Thank you for your interest in contributing to **ForMash 3D**!

ForMash 3D is an early, experimental, pre-alpha project that has been heavily AI-assisted and vibe-coded. As a result, there are rough edges, areas for optimization, technical debt, and bugs. We welcome contributions from developers, researchers, technical artists, and 3D enthusiasts to make the platform more reliable, modular, and performant.

---

## 🧭 Code of Conduct & Contribution Guidelines

1. **Be Respectful & Constructive**: We are here to learn, build, and improve 3D generative tooling together.
2. **Focused Pull Requests**: Keep pull requests focused on a single feature, bug fix, or documentation enhancement. Avoid large PRs that mix formatting, unrelated refactoring, and functional changes.
3. **Preserve Upstream Attribution**: Never remove license notices, copyright headers, or provenance records for third-party libraries and models.
4. **No Secrets**: Never commit API keys, Hugging Face tokens, credentials, or private URLs.
5. **Update Documentation**: Whenever you change code, architecture, configurations, or APIs, always update the relevant Markdown documentation in `Docs/` or `README.md`.

---

## 🛠️ Prerequisites & Development Environment

- **Operating System**: Linux (Ubuntu 20.04, 22.04, or 24.04 recommended)
- **Node Runtime & Package Manager**: [Bun](https://bun.sh/) (authoritative frontend package manager)
- **Python**: Python 3.10 (managed via Conda with environment name `3daigc-api`)
- **GPU (Required for Inference)**: NVIDIA GPU with CUDA 12.4 capability.
- **Git**: Git

---

## 📦 Getting Started: Clone & Setup

### 1. Clone the Repository

ForMash 3D includes third-party model source code directly in `backend/thirdparty/` as part of the main repository, cloned from `https://github.com/Silentzx2/ForMash3D-thirdparty`:

```bash
git clone https://github.com/Silentzx2/ForMash3D.git
cd ForMash3D
```

Third-party wheels are stored in `backend/thirdparty/wheels/` and are automatically downloaded from the ForMash3D GitHub Release at runtime.

### 2. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Review `.env` and configure your local ports, CUDA device ID, and optional `HF_TOKEN` if you plan to test gated Hugging Face models.

### 3. Frontend Setup

Install frontend dependencies using Bun:

```bash
bun install
```

Start the Next.js development server:

```bash
bun run dev
```

The frontend will be available at `http://localhost:3000`.

### 4. Backend Setup

> [!WARNING]  
> The automated backend installer (`backend/scripts/install.sh`) installs system dependencies, manages Conda environments, and compiles CUDA extensions. Inspect scripts before running them, and prefer running on dedicated development machines or containers.

To set up the backend Python environment:

```bash
# Option A: Run the backend installer
bash backend/scripts/install.sh

# Option B: Manual setup
conda create -n 3daigc-api python=3.10 -y
conda activate 3daigc-api
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
pip install -r backend/requirements.txt
```

To run the backend FastAPI gateway:

```bash
conda activate 3daigc-api
cd backend
uvicorn api.main_singleworker:app --reload --port 7842
```

The backend Swagger API docs will be accessible at `http://localhost:7842/docs`.

---

## 🧪 Testing & Quality Validation

Before submitting a pull request, run the following checks:

### 1. Frontend Typecheck & Linting
```bash
# Verify TypeScript types without emitting files
npx tsc --noEmit

# Run ESLint
bun run lint

# Test production bundle build
bun run build
```

### 2. Backend Verification & Syntax Checks
```bash
# Verify Python syntax across backend files
python3 -m compileall backend/api backend/core backend/adapters

# Run contract and route registration check
python3 scripts/verify_contracts.py
```

### 3. Git Hygiene
```bash
# Ensure no stray debug files, model checkpoints, or secrets are staged
git status
```

---

## 🔌 Adding or Modifying a Model Adapter

When adding a new model or updating an existing adapter:
1. **Adapter Class**: Place the adapter implementation in `backend/adapters/<model>_adapter.py`. Follow existing patterns from `trellis_adapter.py` or `triposr_adapter.py`.
2. **Factory Registration**: Register the model in `backend/core/scheduler/model_factory.py`.
3. **Configuration**: Add the model's task category, VRAM requirement, and path in `backend/config/models.yaml`.
4. **Third-Party Licensing**: If using external code or checkpoints, record the upstream repository, authors, and license in [Docs/MODEL_LICENSES.md](Docs/MODEL_LICENSES.md).
5. **Frontend UI**: If new generation parameters are introduced, update `constants/models.ts` and `features/workspace/Panels/GeneratePanel.tsx`.

---

## 📬 Pull Request (PR) Process

1. **Fork & Branch**: Fork the repo and branch off `main` (e.g. `git checkout -b fix/issue-description` or `git checkout -b feat/feature-name`).
2. **Commit Messages**: Use concise, conventional commit messages:
   - `fix: resolve VRAM leak in model unloading`
   - `feat: support custom mesh export format`
   - `docs: update setup instructions for CUDA 12.4`
3. **PR Description**: Include the following details in your PR:
   - **Summary**: What does this PR change and why?
   - **Fixes**: Reference any open issue numbers (`Fixes #12`).
   - **Testing Performed**: How was this verified? (CLI command, frontend test, GPU specs).
   - **Screenshots**: Include screenshots or video recordings for UI changes.
   - **Limitations / Breaking Changes**: Note any known limitations or downstream impacts.

---

## 🔒 Security Disclosures

If you discover a potential security vulnerability (e.g., path traversal, remote code execution, secret leakage), please **do NOT report it in a public GitHub issue**. Instead, follow the responsible disclosure guidelines in [SECURITY.md](SECURITY.md).
