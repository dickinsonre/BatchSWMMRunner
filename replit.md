# BatchSWMM - Batch EPA SWMM Processing Tool

## Overview

BatchSWMM is a local desktop application designed for batch processing EPA SWMM (Storm Water Management Model) `.inp` files. The application provides real-time progress tracking via WebSocket connections and displays comprehensive results summaries. Built as a full-stack TypeScript application, it uses React for the frontend and Express for the backend, with a focus on professional engineering/technical workflows.

## Recent Changes

- **Mar 2026 (latest)**: Updated HANDOVER.md to 1,599 lines with accurate file line counts (routes.ts 1,018, total key files 8,484), dedicated binary output parser section, corrected architecture diagram, comprehensive 21-section table of contents
- **Mar 2026**: Added SWMM `.out` binary parser (`parseSwmmOutputBinary()` in `server/routes.ts`) — reads EPA SWMM 5.2 binary format (magic 516114522), extracts node/link time series for interactive charts; max 2,000 periods, OLE date conversion
- **Mar 2026**: Added "Run SWMM" feature to ReSWMM page with before/after SimulationComparison (side-by-side table + grouped bar charts)
- **Mar 2026**: Added "Run SWMM" button to Folder View file detail panel
- **Mar 2026**: Added shared `AppHeader` with navigation tabs, SWMM status badge, ThemeToggle
- **Mar 2026**: Added 5 color themes (Default, Auburn, Autodesk, UF, OSU) with dark mode, persisted via localStorage
- **Mar 2026**: Added ReSWMM page (`/reswmm`) with Fixed Interval + dx/D Ratio discretization, CFL analysis, lengthening
- **Mar 2026**: Added Folder View (`/folder`) with SVG network map, element stats, conduit histogram
- **Mar 2026**: Added client-side INP parser (15 sections: junctions, conduits, subcatchments, xsections, etc.)
- **Mar 2026**: Added Results Dashboard (`/dashboard`) with 4 Recharts charts + metrics table
- **Mar 2026**: Compiled EPA SWMM 5.2.4 into `swmm-engine/runswmm` (511KB ELF binary)
- **Mar 2026**: WebSocket system with 7 message types, message buffering, 500ms delay
- **Mar 2026**: Report generation: HTML/Markdown/CSV with analysis + recommendations

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework & Build System:**
- React with TypeScript for type safety and component-based UI
- Vite as the build tool and development server
- Wouter for lightweight client-side routing

**UI Component System:**
- Shadcn/ui component library (New York variant) for consistent, accessible UI primitives
- Radix UI primitives as the foundation for complex interactive components
- Tailwind CSS for utility-first styling with custom design tokens
- Material Design principles adapted for desktop productivity software

**Design System:**
- Typography: Inter font family for UI elements, JetBrains Mono for monospace/technical content
- Custom color system using HSL variables with CSS custom properties for theming
- Spacing primitives based on Tailwind's scale (2, 4, 6, 8 units)
- Component-specific elevation system using shadow utilities

**State Management:**
- TanStack Query (React Query) for server state management and caching
- Local component state using React hooks
- Custom hooks for reusable stateful logic (e.g., `use-toast`, `use-mobile`)

**Real-time Communication:**
- WebSocket connections for live progress updates during batch processing
- Client maintains WebSocket connection per job ID for isolated progress streams

### Backend Architecture

**Server Framework:**
- Express.js with TypeScript for the HTTP server
- Native Node.js `http` module wrapped by Express for HTTP server creation
- Custom middleware for request logging and JSON response capture

**API Design:**
- RESTful endpoints for batch job creation and management
- WebSocket endpoint (`/api/ws`) for real-time progress streaming
- File upload handling via Multer middleware with `.inp` file validation
- Path-based WebSocket routing using job IDs as query parameters

**Process Management:**
- Child process spawning for executing SWMM simulations
- In-memory job tracking with status updates
- Sequential file processing with progress callbacks

**Data Storage:**
- In-memory storage implementation (`MemStorage`) for batch job state
- Interface-based storage abstraction (`IStorage`) allowing future database integration
- File system temporary storage for uploaded `.inp` files (in `uploads/` directory)

**Development Infrastructure:**
- Vite middleware integration for development hot module replacement
- Custom logging system with timestamped console output
- Replit-specific plugins for development tooling (cartographer, dev banner, runtime error modal)

### Data Models

**Core Schema (Zod-based validation):**
- `BatchJob`: Tracks processing state, file list, current progress, and results
- `UploadFile`: Metadata for uploaded SWMM input files
- `ProcessResult`: Individual file processing outcomes (success/failure with optional error messages)

**Job Status Flow:**
- `idle` → `processing` → `completed` or `cancelled`
- Each file within a job transitions through processing with success/failed status

**Type Safety:**
- Shared schema definitions between frontend and backend (`shared/schema.ts`)
- Zod schemas provide both runtime validation and TypeScript type inference
- Consistent type contracts across the full stack

### External Dependencies

**Database:**
- Currently using in-memory storage
- Drizzle ORM configured for PostgreSQL (via `@neondatabase/serverless`)
- Database integration prepared but not actively used (Neon Database ready)
- Migration system configured via Drizzle Kit

**File Processing:**
- Multer for multipart/form-data file uploads
- Native Node.js `child_process` for SWMM executable invocation
- File system operations for temporary file storage

**UI Libraries:**
- Complete Radix UI primitive collection for accessible components
- Lucide React for iconography
- date-fns for date manipulation
- class-variance-authority (CVA) for component variant management
- clsx and tailwind-merge for className composition

**Development Tools:**
- TypeScript compiler for type checking
- ESBuild for production server bundling
- TSX for development server execution
- Replit-specific development plugins

**Session Management:**
- `connect-pg-simple` for PostgreSQL-backed session storage (configured but sessions not actively implemented)

**WebSocket:**
- `ws` library for WebSocket server implementation
- Client-side native WebSocket API for connections

### Build & Deployment

**Development Mode:**
- Vite dev server with HMR for frontend
- TSX execution for backend with auto-restart
- Concurrent frontend/backend development on single port via Vite middleware

**Production Build:**
- Vite builds frontend to `dist/public`
- ESBuild bundles backend to `dist/index.js` as ESM module
- Static file serving from built frontend directory
- Environment-based configuration via `NODE_ENV`

**Configuration Management:**
- TypeScript path aliases for clean imports (`@/`, `@shared/`, `@assets/`)
- Centralized Tailwind configuration with custom design tokens
- PostCSS with Tailwind and Autoprefixer
- Vite configuration for module resolution and build optimization