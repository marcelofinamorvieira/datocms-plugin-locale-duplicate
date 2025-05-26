# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` - Start development server on http://localhost:5173
- `npm run build` - Build for production (TypeScript check + Vite build)
- `npm run preview` - Preview production build locally

Note: No linting or testing commands are configured in this project.

## Architecture Overview

This is a DatoCMS plugin that duplicates content between locales. The plugin is built with:
- Vite + React + TypeScript
- DatoCMS Plugin SDK for integration
- CMA Client Browser for API operations

### Key Components

- **Entry Point**: `src/main.tsx` - Connects the DatoCMS Plugin SDK
- **Main Component**: `src/entrypoints/ConfigScreen.tsx` - Contains all plugin logic in a single file (1859 lines)
- **Build Output**: `dist/index.html` - Single HTML file loaded by DatoCMS

### Plugin Functionality

The plugin provides a UI to:
1. Select source and target locales
2. Choose specific models to duplicate (with select all/none options)
3. Display real-time progress during duplication
4. Show comprehensive summary with success/failure statistics

### DatoCMS Integration

- Requires `currentUserAccessToken` permission to access CMA API
- Handles all DatoCMS record types including nested blocks and structured text
- Supports locale formats: ISO-639-1 codes and country variations (e.g., en-US)

## Development Notes

- The entire plugin logic is contained in `ConfigScreen.tsx` - consider this file for any functionality changes
- Uses inline styles and CSS modules for styling
- No environment-specific configuration needed - API tokens are provided by DatoCMS at runtime
- The plugin overwrites all content in the target locale - this is by design

## Design Principles

- For design principles always use datocms-react-ui and the principles detailed at https://www.datocms.com/docs/plugin-sdk/react-datocms-ui

## Planned Feature Expansion

The plugin is expanding beyond mass locale duplication to include two distinct features:

### 1. Mass Locale Duplication (Current Feature)
- Bulk duplicate content across all records in selected models from one locale to another
- Accessible from the plugin's main config screen
- Use case: Migrating content between locales or setting up similar locales

### 2. Field-Level Copy Feature (Planned)
- Allow users to configure specific fields from models in the config screen
- These configured fields will have a copy button in the record editing interface
- Users can copy field values between locales while editing individual records
- Use case: Selective field copying during content editing workflow

### Implementation Plan
1. Refactor `ConfigScreen.tsx` to support feature selection/tabs
2. Add field selection UI for configuring which fields should have copy buttons
3. Implement a new entrypoint for the field widget that renders copy buttons
4. Store field configuration in plugin parameters
5. Both features will coexist in the same plugin but serve different workflows