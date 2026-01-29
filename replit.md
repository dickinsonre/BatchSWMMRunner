# BatchSWMM - Batch EPA SWMM Processing Tool

## Overview

BatchSWMM is a local desktop application designed for batch processing EPA SWMM (Storm Water Management Model) `.inp` files. The application provides real-time progress tracking via WebSocket connections and displays comprehensive results summaries. Built as a full-stack TypeScript application, it uses React for the frontend and Express for the backend, with a focus on professional engineering/technical workflows.

## Recent Changes

- **Jan 2026**: Added "What You'll Get" expected outputs panel showing .rpt, .out files and results summary
- **Jan 2026**: Made processing button always visible (disabled until files uploaded) for clearer UX
- **Jan 2026**: Added workflow steps visualization (Upload → Process → Results)
- **Jan 2026**: Added "How to Use" instructions panel with 3-step guide
- **Jan 2026**: Enhanced file upload with file size display and validation warnings
- **Jan 2026**: Improved progress dashboard with elapsed time, ETA, and success/failure counters
- **Jan 2026**: Added CSV export functionality to results display

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