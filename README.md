# BatchSWMMRunner

A full-stack web application for uploading, analyzing, discretizing, and batch-running **EPA SWMM5** models, with integrated report generation, mobile-friendly UI improvements, and support for both the SWMM engine source and API-oriented execution workflows. The repository is publicly hosted as the GitHub companion to the Replit app at [replit.com/@robertdickinson/BatchSWMMRunner](https://replit.com/@robertdickinson/BatchSWMMRunner).[1]

## Overview

This repository is more than a simple script runner. The visible project structure shows a complete application with a **TypeScript client**, a **server layer**, shared type definitions, uploaded/input assets, and embedded SWMM engine/source folders, indicating that the app combines a modern web interface with compiled SWMM execution and file-processing logic.[1]

The commit history visible on the repo page suggests that the application has evolved beyond basic upload-and-run behavior. Recent commits mention **mobile phone layout optimization**, **sample model selection**, **file handling updates**, **AI-powered report generation and analysis**, **discretization-change summaries**, and **comprehensive SWMM5 API documentation with API mode enabled for simulation**.[1]

## What the application appears to do

Based on the repository name, structure, and commit history, BatchSWMMRunner appears to support the following workflow:[1]

1. Upload one or more **SWMM `.inp` files** through the web interface.[1]
2. Process or analyze the files on the server side.[1]
3. Run SWMM simulations in a batch-oriented workflow using the bundled engine/source assets.[1]
4. Generate reports, including summaries of **discretization changes** and possibly AI-assisted analysis outputs.[1]
5. Provide sample-model selection and mobile-friendly usability for broader access across devices.[1]

The presence of both `swmm-engine/` and `swmm-source/` strongly suggests that the repository is designed not only to call SWMM, but also to expose or document lower-level engine/API capabilities inside the application.[1]

## Repository structure

The root directory shows a mature application split across frontend, backend, shared models, SWMM-native code, and supporting content.[1]

| Path | Purpose |
|---|---|
| `client/` | Frontend application, likely built with TypeScript and a modern web framework.[1] |
| `server/` | Backend application logic for uploads, processing, and SWMM execution orchestration.[1] |
| `shared/` | Shared type definitions and common logic used by both client and server.[1] |
| `swmm-engine/` | Bundled SWMM engine code or compiled interface layer for simulation execution.[1] |
| `swmm-source/` | SWMM source files and related native implementation assets.[1] |
| `public/` | Public static assets for the web application.[1] |
| `attached_assets/` | Additional images or supporting generated assets used in reports or UI content.[1] |
| `uploads/` | Uploaded or example model files managed by the application.[1] |
| `replit.md` | Replit-specific project notes and architecture context.[1] |
| `HANDOVER.md` | Project handover notes reflecting implementation details and maintenance state.[1] |
| `linkedin_batchswmm_article.md` | Supporting long-form content about the application.[1] |
| `linkedin_reswmm_article.md` | Related content on ReSWMM and discretization topics connected to the app.[1] |

The technology mix reported by GitHub is **69.7% C** and **28.0% TypeScript**, with smaller amounts of CSS, C++, CMake, and Python.[1] That confirms the repository bridges a web application layer with native SWMM engine code rather than acting as a frontend-only tool.[1]

## Likely feature set

The visible commit messages provide unusually strong clues about the application's capabilities. Features implied directly by the current repository page include:[1]

- **SWMM `.inp` upload and processing** from the commit that added the upload interface.[1]
- **Sample model selection** and updated file handling.[1]
- **AI-powered report generation and analysis**.[1]
- **Summary reporting of discretization changes**.[1]
- **API mode for simulation** with added SWMM5 API documentation.[1]
- **Improved mobile layout and spacing** for phone viewing.[1]
- **Error prevention for certain conduit shapes during discretization**.[1]

Taken together, this points to an application designed for practical model preprocessing and simulation management, not just raw batch execution.[1]

## Why this repository is useful

For SWMM practitioners, a batch-processing web app can save considerable effort when running multiple scenarios, preparing input files, reviewing discretization edits, or generating consistent summary outputs across many models. The additional presence of discretization-focused commits and ReSWMM-related article content suggests that this tool may be especially helpful for workflows where model preprocessing and simulation execution need to be tightly linked.[1]

The combination of a browser interface with native engine folders is also important. It implies the repository can serve both **end users**, who want a practical interface for running models, and **developers**, who want to inspect or modify the SWMM integration itself.[1]

## Repository status

The current GitHub page shows that the repository has **145 commits**, **1 branch**, **0 tags**, no releases, and no published packages.[1] It is a public repository with a Replit app listed in the About section, and the latest visible commit is from two months ago, indicating recent active development.[1]

The repository currently has no README at all, which makes the codebase harder to approach despite its relatively rich structure and ongoing development. A detailed README would therefore provide immediate value for both users and collaborators.[1]

## What a stronger README should include

A good README for this repository should explain:

- What BatchSWMMRunner actually does from a user perspective.[1]
- Which features are available today: upload, batch run, analysis, AI reports, discretization summaries, and API mode.[1]
- How the frontend, backend, and SWMM-native code fit together.[1]
- How to run the project locally from the repository instead of only through Replit.[1]
- What kinds of files go into `uploads/`, `attached_assets/`, `swmm-engine/`, and `swmm-source/`.[1]
- Whether this tool is intended for EPA SWMM5, OWA-SWMM, or a custom embedded SWMM build.[1]

## Recommended README draft

Below is a fuller GitHub-facing README draft that could be used directly in the repository:

***

# BatchSWMMRunner

`BatchSWMMRunner` is a web-based application for uploading, preprocessing, analyzing, and batch-running **SWMM5** models. It combines a modern TypeScript frontend with a server-side processing layer and bundled SWMM engine/source code so users can work with model files through a browser rather than a manual file-by-file workflow.[1]

## Purpose

The application is designed to make repeated SWMM simulation workflows easier to manage. Instead of opening and running models one at a time, users can upload input files, process them through the application, review changes such as discretization edits, and generate report-style outputs from a single interface.[1]

## Repository contents

- `client/` — frontend web application.[1]
- `server/` — backend processing and execution logic.[1]
- `shared/` — shared types and common code.[1]
- `swmm-engine/` — SWMM execution or API integration layer.[1]
- `swmm-source/` — SWMM source files bundled with the app.[1]
- `public/` — static web assets.[1]
- `uploads/` — uploaded or working model files.[1]
- `attached_assets/` — supporting images and generated assets.[1]

## Features suggested by the current codebase

- Upload and process SWMM `.inp` files.[1]
- Batch-run simulations.[1]
- Use sample model selection for testing or demonstration.[1]
- Generate reports, including discretization-change summaries.[1]
- Support AI-assisted report generation and analysis.[1]
- Use a mobile-friendly interface with updated phone layout support.[1]
- Access SWMM5 API-oriented simulation mode.[1]

## Development notes

The repository mixes web technologies with native-code assets. GitHub reports the codebase as primarily **C** and **TypeScript**, which suggests that the application includes both a browser UI and direct integration with the SWMM engine or its source code.[1]

## Status

The project is actively developed and currently has 145 commits on the `main` branch.[1] It has no releases or tags yet, so the repository should currently be treated as a source-first application rather than a packaged product.[1]

## Related link

Live/project source link: [https://replit.com/@robertdickinson/BatchSWMMRunner](https://replit.com/@robertdickinson/BatchSWMMRunner) [1]

***
