"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Input,
  SearchInput,
  Badge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Icon,
  Display,
  Heading,
  Body,
  Caption,
  MovieTitle,
} from "@/components/ui";

// ============================================================================
// DESIGN SYSTEM TEST PAGE
// Displays all component variants for visual testing and verification
// ============================================================================

// Example icons for testing
function StarIcon() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M14 5l7 7m0 0l-7 7m7-7H3"
      />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
      />
    </svg>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12">
      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
        {title}
      </h2>
      {description && (
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

export default function ComponentsTestPage() {
  const [inputValue, setInputValue] = useState("");
  const [emailValue, setEmailValue] = useState("");
  const [searchValue, setSearchValue] = useState("");
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Page Header */}
        <div className="mb-12 text-center">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-3">
            Design System Components
          </h1>
          <p className="text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Core UI primitives for LettrSuggest. These components form the
            foundation of the design system with full variant support,
            accessibility, and dark mode.
          </p>
        </div>

        {/* ========== BUTTON SECTION ========== */}
        <Section
          title="Button"
          description="5 variants (primary, secondary, ghost, danger, success) × 3 sizes (sm, md, lg)"
        >
          {/* Button Variants */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Variants
            </h3>
            <div className="flex flex-wrap gap-4">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="success">Success</Button>
            </div>
          </div>

          {/* Button Sizes */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Sizes
            </h3>
            <div className="flex flex-wrap items-end gap-4">
              <Button variant="primary" size="sm">
                Small (36px)
              </Button>
              <Button variant="primary" size="md">
                Medium (44px)
              </Button>
              <Button variant="primary" size="lg">
                Large (52px)
              </Button>
            </div>
          </div>

          {/* Buttons with Icons */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              With Icons
            </h3>
            <div className="flex flex-wrap gap-4">
              <Button variant="primary" icon={<StarIcon />}>
                Get Suggestions
              </Button>
              <Button variant="secondary" icon={<SettingsIcon />}>
                Settings
              </Button>
              <Button variant="danger" icon={<TrashIcon />}>
                Delete
              </Button>
              <Button variant="success" icon={<CheckIcon />}>
                Confirm
              </Button>
              <Button variant="ghost" icon={<SettingsIcon />}>
                Configure
              </Button>
            </div>
          </div>

          {/* Right Icons */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              With Right Icons
            </h3>
            <div className="flex flex-wrap gap-4">
              <Button variant="primary" rightIcon={<ArrowRightIcon />}>
                Continue
              </Button>
              <Button variant="secondary" rightIcon={<ArrowRightIcon />}>
                Learn More
              </Button>
            </div>
          </div>

          {/* Loading States */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Loading States
            </h3>
            <div className="flex flex-wrap gap-4">
              <Button variant="primary" loading>
                Saving...
              </Button>
              <Button variant="secondary" loading>
                Loading...
              </Button>
              <Button variant="danger" loading>
                Deleting...
              </Button>
              <Button variant="success" loading>
                Confirming...
              </Button>
            </div>
          </div>

          {/* Disabled States */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Disabled States
            </h3>
            <div className="flex flex-wrap gap-4">
              <Button variant="primary" disabled>
                Disabled Primary
              </Button>
              <Button variant="secondary" disabled>
                Disabled Secondary
              </Button>
              <Button variant="ghost" disabled>
                Disabled Ghost
              </Button>
            </div>
          </div>

          {/* Full Width */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Full Width
            </h3>
            <div className="max-w-md space-y-3">
              <Button variant="primary" fullWidth icon={<StarIcon />}>
                Full Width Primary
              </Button>
              <Button variant="secondary" fullWidth>
                Full Width Secondary
              </Button>
            </div>
          </div>

          {/* As Link */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              As Link (href)
            </h3>
            <div className="flex flex-wrap gap-4">
              <Button
                variant="primary"
                href="/suggest"
                rightIcon={<ArrowRightIcon />}
              >
                Get Suggestions
              </Button>
              <Button variant="ghost" href="/settings" icon={<SettingsIcon />}>
                Settings
              </Button>
            </div>
          </div>
        </Section>

        {/* ========== CARD SECTION ========== */}
        <Section
          title="Card"
          description="5 variants (default, gradient, outlined, interactive, elevated) with gradient color options"
        >
          {/* Card Variants */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Variants
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card variant="default">
                <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Default Card
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  White background with subtle border. Great for general content
                  containers.
                </p>
              </Card>

              <Card variant="outlined">
                <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Outlined Card
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Transparent with a thicker border. Use for secondary emphasis.
                </p>
              </Card>

              <Card variant="elevated">
                <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Elevated Card
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Lifted with shadow. Good for featured content and modals.
                </p>
              </Card>
            </div>
          </div>

          {/* Interactive Card */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Interactive Card (Hover & Click)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
              <Card
                variant="interactive"
                onClick={() => alert("Card clicked!")}
              >
                <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Clickable Card
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Hover to see the effect. Click to trigger an action.
                </p>
              </Card>

              <Card
                variant="interactive"
                onClick={() => alert("Movie selected!")}
              >
                <div className="flex gap-4">
                  <div className="w-16 h-24 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg flex-shrink-0" />
                  <div>
                    <h4 className="font-semibold text-gray-900 dark:text-gray-100">
                      Movie Title
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      2024 • Drama
                    </p>
                    <div className="flex items-center gap-1 mt-2">
                      <span className="text-amber-500">★★★★</span>
                      <span className="text-gray-400">☆</span>
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {/* Gradient Cards */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Gradient Cards
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card variant="gradient" gradient="brand">
                <h4 className="font-semibold text-white mb-2">
                  Brand Gradient
                </h4>
                <p className="text-sm text-white/80">
                  Violet to fuchsia. Use for hero sections and featured content.
                </p>
              </Card>

              <Card variant="gradient" gradient="success">
                <h4 className="font-semibold text-white mb-2">
                  Success Gradient
                </h4>
                <p className="text-sm text-white/80">
                  Emerald to teal. Great for positive confirmations.
                </p>
              </Card>

              <Card variant="gradient" gradient="warning">
                <h4 className="font-semibold text-white mb-2">
                  Warning Gradient
                </h4>
                <p className="text-sm text-white/80">
                  Amber to orange. Use for alerts and cautions.
                </p>
              </Card>

              <Card variant="gradient" gradient="info">
                <h4 className="font-semibold text-white mb-2">Info Gradient</h4>
                <p className="text-sm text-white/80">
                  Blue to cyan. Perfect for informational callouts.
                </p>
              </Card>

              <Card variant="gradient" gradient="danger">
                <h4 className="font-semibold text-white mb-2">
                  Danger Gradient
                </h4>
                <p className="text-sm text-white/80">
                  Red to rose. Use for destructive actions.
                </p>
              </Card>
            </div>
          </div>

          {/* Card Padding Options */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Padding Options
            </h3>
            <div className="flex flex-wrap gap-4">
              <Card padding="none" className="w-40">
                <div className="bg-violet-100 dark:bg-violet-900/30 p-3 text-center">
                  <span className="text-sm text-violet-700 dark:text-violet-300">
                    padding=none
                  </span>
                </div>
              </Card>
              <Card padding="sm" className="w-40">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  padding=sm
                </span>
              </Card>
              <Card padding="md" className="w-40">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  padding=md (default)
                </span>
              </Card>
              <Card padding="lg" className="w-40">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  padding=lg
                </span>
              </Card>
            </div>
          </div>

          {/* Card with Composition */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Card Composition (Header, Content, Footer)
            </h3>
            <div className="max-w-md">
              <Card variant="elevated" padding="none">
                <CardHeader className="px-6 pt-6">
                  <CardTitle>Movie Details</CardTitle>
                </CardHeader>
                <CardContent className="px-6">
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    This demonstrates the compositional nature of the Card
                    component with separate header, content, and footer
                    sections.
                  </p>
                </CardContent>
                <CardFooter className="px-6 pb-6">
                  <Button variant="primary" size="sm">
                    Watch Now
                  </Button>
                  <Button variant="ghost" size="sm">
                    Add to Watchlist
                  </Button>
                </CardFooter>
              </Card>
            </div>
          </div>
        </Section>

        {/* ========== INPUT SECTION ========== */}
        <Section
          title="Input"
          description="Text inputs with label, error, helper text, and icon support"
        >
          {/* Basic Inputs */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Basic Inputs
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
              <Input
                label="Username"
                placeholder="Enter your username"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
              />
              <Input
                label="Email Address"
                type="email"
                placeholder="you@example.com"
                value={emailValue}
                onChange={(e) => setEmailValue(e.target.value)}
              />
            </div>
          </div>

          {/* With Helper Text */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              With Helper Text
            </h3>
            <div className="max-w-md">
              <Input
                label="Display Name"
                placeholder="Choose a name"
                helperText="This will be shown publicly on your profile."
              />
            </div>
          </div>

          {/* Error State */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Error State
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
              <Input
                label="Email"
                type="email"
                placeholder="you@example.com"
                value="invalid-email"
                error="Please enter a valid email address"
              />
              <Input
                label="Password"
                type="password"
                placeholder="••••••••"
                error="Password must be at least 8 characters"
              />
            </div>
          </div>

          {/* With Icons */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              With Icons
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
              <Input
                label="Email"
                type="email"
                placeholder="you@example.com"
                icon={<MailIcon />}
              />
              <Input
                label="Username"
                placeholder="johndoe"
                icon={<UserIcon />}
              />
            </div>
          </div>

          {/* Search Input */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Search Input
            </h3>
            <div className="max-w-md">
              <SearchInput
                placeholder="Search movies..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
              />
            </div>
          </div>

          {/* Sizes */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Sizes
            </h3>
            <div className="space-y-4 max-w-md">
              <Input
                label="Small Input (36px)"
                placeholder="Small size"
                inputSize="sm"
              />
              <Input
                label="Medium Input (44px - default)"
                placeholder="Medium size"
                inputSize="md"
              />
              <Input
                label="Large Input (52px)"
                placeholder="Large size"
                inputSize="lg"
              />
            </div>
          </div>

          {/* Disabled State */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Disabled State
            </h3>
            <div className="max-w-md">
              <Input
                label="Disabled Input"
                placeholder="Cannot edit"
                value="Read-only value"
                disabled
              />
            </div>
          </div>

          {/* Full Width */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Full Width
            </h3>
            <Input
              label="Full Width Input"
              placeholder="This input spans the full container width"
              fullWidth
            />
          </div>
        </Section>

        {/* ========== BADGE SECTION ========== */}
        <Section
          title="Badge"
          description="6 variants (default, primary, success, warning, danger, info) × 3 sizes (sm, md, lg)"
        >
          {/* Badge Variants */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Variants
            </h3>
            <div className="flex flex-wrap gap-3">
              <Badge variant="default">Default</Badge>
              <Badge variant="primary">Primary</Badge>
              <Badge variant="success">Success</Badge>
              <Badge variant="warning">Warning</Badge>
              <Badge variant="danger">Danger</Badge>
              <Badge variant="info">Info</Badge>
            </div>
          </div>

          {/* Badge Sizes */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Sizes
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="primary" size="sm">
                Small
              </Badge>
              <Badge variant="primary" size="md">
                Medium (default)
              </Badge>
              <Badge variant="primary" size="lg">
                Large
              </Badge>
            </div>
          </div>

          {/* Badges with Icons */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              With Icons
            </h3>
            <div className="flex flex-wrap gap-3">
              <Badge variant="success" icon={<Icon name="check" size="xs" />}>
                Verified
              </Badge>
              <Badge variant="warning" icon={<Icon name="warning" size="xs" />}>
                Mixed Reviews
              </Badge>
              <Badge variant="danger" icon={<Icon name="alert" size="xs" />}>
                Critical
              </Badge>
              <Badge variant="info" icon={<Icon name="info" size="xs" />}>
                New Feature
              </Badge>
            </div>
          </div>

          {/* Badges with Dots */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              With Status Dots
            </h3>
            <div className="flex flex-wrap gap-3">
              <Badge variant="success" dot>
                Online
              </Badge>
              <Badge variant="warning" dot>
                Away
              </Badge>
              <Badge variant="danger" dot>
                Busy
              </Badge>
              <Badge variant="primary" dot>
                Featured
              </Badge>
            </div>
          </div>

          {/* Real-world Examples */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Real-World Usage (MovieCard)
            </h3>
            <Card variant="default" className="max-w-md">
              <div className="flex gap-4">
                <div className="w-24 h-36 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-lg flex-shrink-0" />
                <div className="flex-1">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100 mb-2">
                    The Shawshank Redemption
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                    1994 • Drama
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="success" size="sm">
                      🍅 97%
                    </Badge>
                    <Badge variant="primary" size="sm">
                      High Consensus
                    </Badge>
                    <Badge variant="info" size="sm" dot>
                      4 Sources
                    </Badge>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </Section>

        {/* ========== TABS SECTION ========== */}
        <Section
          title="Tabs"
          description="Composition API with full keyboard navigation (Arrow keys, Home, End)"
        >
          {/* Basic Tabs */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Basic Tabs (Uncontrolled)
            </h3>
            <Card variant="default" className="max-w-2xl">
              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="taste">Taste Profile</TabsTrigger>
                  <TabsTrigger value="history">Watch History</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">
                  <p className="text-gray-600 dark:text-gray-400">
                    This is the Overview tab content. Click the other tabs or
                    use arrow keys to navigate. Home/End go to first/last tab.
                  </p>
                </TabsContent>
                <TabsContent value="taste">
                  <p className="text-gray-600 dark:text-gray-400">
                    This is the Taste Profile tab content. Your movie
                    preferences would be displayed here.
                  </p>
                </TabsContent>
                <TabsContent value="history">
                  <p className="text-gray-600 dark:text-gray-400">
                    This is the Watch History tab content. Your recently watched
                    films would appear here.
                  </p>
                </TabsContent>
              </Tabs>
            </Card>
          </div>

          {/* Controlled Tabs */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Controlled Tabs
            </h3>
            <div className="flex gap-3 mb-4">
              <Button
                variant={activeTab === "overview" ? "primary" : "secondary"}
                size="sm"
                onClick={() => setActiveTab("overview")}
              >
                Go to Overview
              </Button>
              <Button
                variant={activeTab === "stats" ? "primary" : "secondary"}
                size="sm"
                onClick={() => setActiveTab("stats")}
              >
                Go to Stats
              </Button>
              <Button
                variant={activeTab === "settings" ? "primary" : "secondary"}
                size="sm"
                onClick={() => setActiveTab("settings")}
              >
                Go to Settings
              </Button>
            </div>
            <Card variant="default" className="max-w-2xl">
              <Tabs
                defaultValue="overview"
                value={activeTab}
                onValueChange={setActiveTab}
              >
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="stats">Stats</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                <TabsContent value="overview">
                  <p className="text-gray-600 dark:text-gray-400">
                    Overview content - controlled by external buttons above.
                    Current tab: <strong>{activeTab}</strong>
                  </p>
                </TabsContent>
                <TabsContent value="stats">
                  <p className="text-gray-600 dark:text-gray-400">
                    Stats content - you can control tabs programmatically.
                    Current tab: <strong>{activeTab}</strong>
                  </p>
                </TabsContent>
                <TabsContent value="settings">
                  <p className="text-gray-600 dark:text-gray-400">
                    Settings content - great for form wizards. Current tab:{" "}
                    <strong>{activeTab}</strong>
                  </p>
                </TabsContent>
              </Tabs>
            </Card>
          </div>

          {/* Many Tabs (Horizontal Scroll) */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Many Tabs (Horizontal Scroll on Mobile)
            </h3>
            <Card variant="default" className="max-w-2xl">
              <Tabs defaultValue="tab1">
                <TabsList>
                  <TabsTrigger value="tab1">Action</TabsTrigger>
                  <TabsTrigger value="tab2">Comedy</TabsTrigger>
                  <TabsTrigger value="tab3">Drama</TabsTrigger>
                  <TabsTrigger value="tab4">Horror</TabsTrigger>
                  <TabsTrigger value="tab5">Sci-Fi</TabsTrigger>
                  <TabsTrigger value="tab6">Romance</TabsTrigger>
                  <TabsTrigger value="tab7">Thriller</TabsTrigger>
                </TabsList>
                <TabsContent value="tab1">
                  <p className="text-gray-600 dark:text-gray-400">
                    Action movies content
                  </p>
                </TabsContent>
                <TabsContent value="tab2">
                  <p className="text-gray-600 dark:text-gray-400">
                    Comedy movies content
                  </p>
                </TabsContent>
                <TabsContent value="tab3">
                  <p className="text-gray-600 dark:text-gray-400">
                    Drama movies content
                  </p>
                </TabsContent>
                <TabsContent value="tab4">
                  <p className="text-gray-600 dark:text-gray-400">
                    Horror movies content
                  </p>
                </TabsContent>
                <TabsContent value="tab5">
                  <p className="text-gray-600 dark:text-gray-400">
                    Sci-Fi movies content
                  </p>
                </TabsContent>
                <TabsContent value="tab6">
                  <p className="text-gray-600 dark:text-gray-400">
                    Romance movies content
                  </p>
                </TabsContent>
                <TabsContent value="tab7">
                  <p className="text-gray-600 dark:text-gray-400">
                    Thriller movies content
                  </p>
                </TabsContent>
              </Tabs>
            </Card>
          </div>

          {/* Disabled Tab */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              With Disabled Tab
            </h3>
            <Card variant="default" className="max-w-2xl">
              <Tabs defaultValue="available">
                <TabsList>
                  <TabsTrigger value="available">Available</TabsTrigger>
                  <TabsTrigger value="premium" disabled>
                    Premium (Locked)
                  </TabsTrigger>
                  <TabsTrigger value="beta">Beta Features</TabsTrigger>
                </TabsList>
                <TabsContent value="available">
                  <p className="text-gray-600 dark:text-gray-400">
                    This content is available to all users.
                  </p>
                </TabsContent>
                <TabsContent value="beta">
                  <p className="text-gray-600 dark:text-gray-400">
                    Beta features - try at your own risk!
                  </p>
                </TabsContent>
              </Tabs>
            </Card>
          </div>
        </Section>

        {/* ========== ICON SECTION ========== */}
        <Section
          title="Icon"
          description="40+ icons with 5 sizes (xs, sm, md, lg, xl)"
        >
          {/* Icon Sizes */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Sizes
            </h3>
            <div className="flex flex-wrap items-end gap-6">
              <div className="flex flex-col items-center gap-2">
                <Icon name="star" size="xs" />
                <span className="text-xs text-gray-500">xs (12px)</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Icon name="star" size="sm" />
                <span className="text-xs text-gray-500">sm (16px)</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Icon name="star" size="md" />
                <span className="text-xs text-gray-500">md (20px)</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Icon name="star" size="lg" />
                <span className="text-xs text-gray-500">lg (24px)</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Icon name="star" size="xl" />
                <span className="text-xs text-gray-500">xl (32px)</span>
              </div>
            </div>
          </div>

          {/* Navigation Icons */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Navigation
            </h3>
            <div className="flex flex-wrap gap-4">
              {(
                ["home", "library", "suggest", "stats", "settings"] as const
              ).map((name) => (
                <div
                  key={name}
                  className="flex flex-col items-center gap-1 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg"
                >
                  <Icon name={name} size="md" />
                  <span className="text-xs text-gray-500">{name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Action Icons */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Actions
            </h3>
            <div className="flex flex-wrap gap-4">
              {(
                [
                  "search",
                  "filter",
                  "close",
                  "check",
                  "trash",
                  "edit",
                  "plus",
                  "minus",
                  "refresh",
                  "download",
                  "upload",
                ] as const
              ).map((name) => (
                <div
                  key={name}
                  className="flex flex-col items-center gap-1 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg"
                >
                  <Icon name={name} size="md" />
                  <span className="text-xs text-gray-500">{name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Status Icons */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Status
            </h3>
            <div className="flex flex-wrap gap-4">
              {(
                [
                  "star",
                  "star-filled",
                  "heart",
                  "heart-filled",
                  "warning",
                  "info",
                  "alert",
                  "check-circle",
                  "x-circle",
                ] as const
              ).map((name) => (
                <div
                  key={name}
                  className="flex flex-col items-center gap-1 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg"
                >
                  <Icon
                    name={name}
                    size="md"
                    className={
                      name.includes("star")
                        ? "text-yellow-500"
                        : name.includes("heart")
                          ? "text-red-500"
                          : name === "warning"
                            ? "text-amber-500"
                            : name === "info"
                              ? "text-blue-500"
                              : name === "check-circle"
                                ? "text-emerald-500"
                                : name === "x-circle"
                                  ? "text-red-500"
                                  : ""
                    }
                  />
                  <span className="text-xs text-gray-500">{name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Arrow/Chevron Icons */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Arrows & Chevrons
            </h3>
            <div className="flex flex-wrap gap-4">
              {(
                [
                  "chevron-down",
                  "chevron-up",
                  "chevron-left",
                  "chevron-right",
                  "arrow-right",
                  "arrow-left",
                  "arrow-up",
                  "arrow-down",
                  "external-link",
                ] as const
              ).map((name) => (
                <div
                  key={name}
                  className="flex flex-col items-center gap-1 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg"
                >
                  <Icon name={name} size="md" />
                  <span className="text-xs text-gray-500">{name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Media Icons */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Media & Misc
            </h3>
            <div className="flex flex-wrap gap-4">
              {(
                [
                  "play",
                  "pause",
                  "film",
                  "tv",
                  "user",
                  "user-circle",
                  "eye",
                  "eye-slash",
                  "clock",
                  "calendar",
                  "bookmark",
                  "share",
                  "menu",
                ] as const
              ).map((name) => (
                <div
                  key={name}
                  className="flex flex-col items-center gap-1 p-3 bg-gray-100 dark:bg-gray-800 rounded-lg"
                >
                  <Icon name={name} size="md" />
                  <span className="text-xs text-gray-500">{name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Loading Spinner */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Loading Spinner
            </h3>
            <div className="flex flex-wrap items-end gap-6">
              <div className="flex flex-col items-center gap-2">
                <Icon name="spinner" size="sm" />
                <span className="text-xs text-gray-500">sm</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Icon name="spinner" size="md" />
                <span className="text-xs text-gray-500">md</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Icon name="spinner" size="lg" />
                <span className="text-xs text-gray-500">lg</span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <Icon name="spinner" size="xl" className="text-violet-500" />
                <span className="text-xs text-gray-500">xl (colored)</span>
              </div>
            </div>
          </div>

          {/* With Button */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Icons in Buttons
            </h3>
            <div className="flex flex-wrap gap-4">
              <Button variant="primary" icon={<Icon name="star" size="sm" />}>
                Get Suggestions
              </Button>
              <Button
                variant="secondary"
                icon={<Icon name="settings" size="sm" />}
              >
                Settings
              </Button>
              <Button variant="danger" icon={<Icon name="trash" size="sm" />}>
                Delete
              </Button>
              <Button
                variant="success"
                icon={<Icon name="check-circle" size="sm" />}
              >
                Confirm
              </Button>
            </div>
          </div>
        </Section>

        {/* ========== COMBINED EXAMPLE ========== */}
        <Section
          title="Combined Example"
          description="A realistic form using all components together"
        >
          <Card variant="elevated" padding="lg" className="max-w-lg">
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl flex items-center justify-center">
                <StarIcon />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Create Your Profile
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Get personalized movie recommendations
              </p>
            </div>

            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
              <Input
                label="Display Name"
                placeholder="How should we call you?"
                icon={<UserIcon />}
                fullWidth
              />
              <Input
                label="Email Address"
                type="email"
                placeholder="you@example.com"
                icon={<MailIcon />}
                helperText="We'll never share your email with anyone."
                fullWidth
              />
              <SearchInput
                label="Favorite Movie"
                placeholder="Search for a movie..."
                fullWidth
              />

              <div className="pt-4 flex gap-3">
                <Button variant="primary" fullWidth icon={<CheckIcon />}>
                  Create Profile
                </Button>
              </div>
              <div className="text-center">
                <Button variant="ghost" size="sm">
                  Skip for now
                </Button>
              </div>
            </form>
          </Card>
        </Section>

        {/* Typography */}
        <Section
          title="Typography"
          description="Text components with Google Fonts (Outfit + Crimson Pro)"
        >
          {/* Display Text */}
          <div className="mb-8">
            <Display className="mb-2">Display Text</Display>
            <Caption>3rem / bold / -0.02em - Use for hero headlines</Caption>
          </div>

          {/* Headings */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Heading Levels
            </h3>
            <div className="space-y-4">
              <div>
                <Heading level={1}>Heading 1 - Page Titles</Heading>
                <Caption className="mt-1">1.875rem / bold / -0.01em</Caption>
              </div>
              <div>
                <Heading level={2}>Heading 2 - Section Headers</Heading>
                <Caption className="mt-1">1.25rem / semibold</Caption>
              </div>
              <div>
                <Heading level={3}>Heading 3 - Card Headers</Heading>
                <Caption className="mt-1">1rem / semibold</Caption>
              </div>
            </div>
          </div>

          {/* Body Text */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Body & Caption
            </h3>
            <div className="space-y-4">
              <div>
                <Body>
                  Body text - Lorem ipsum dolor sit amet, consectetur adipiscing
                  elit. Used for paragraph content and general text throughout
                  the application. This is the primary text style for most
                  content.
                </Body>
                <Caption className="mt-1">
                  0.875rem / normal - Body text
                </Caption>
              </div>
              <div>
                <Caption>
                  Caption text - Small labels, timestamps, metadata
                </Caption>
                <Caption className="mt-1">
                  0.75rem / medium - Captions and labels
                </Caption>
              </div>
            </div>
          </div>

          {/* Movie Title (Serif) */}
          <div className="mb-8">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">
              Movie Title (Serif)
            </h3>
            <div className="space-y-2">
              <MovieTitle>The Shawshank Redemption</MovieTitle>
              <MovieTitle>Pulp Fiction</MovieTitle>
              <MovieTitle>The Godfather</MovieTitle>
              <Caption className="mt-2">
                Crimson Pro serif font for cinematic feel
              </Caption>
            </div>
          </div>

          {/* Typography in Context */}
          <Card>
            <CardHeader>
              <MovieTitle as="h3">The Dark Knight</MovieTitle>
              <Caption>2008 • Action, Crime, Drama • 152 min</Caption>
            </CardHeader>
            <CardContent>
              <Body>
                When the menace known as the Joker wreaks havoc and chaos on the
                people of Gotham, Batman must accept one of the greatest
                psychological and physical tests of his ability to fight
                injustice.
              </Body>
            </CardContent>
            <CardFooter>
              <Badge variant="success" size="sm">
                Certified Fresh
              </Badge>
              <Caption>IMDb 9.0 • Rotten Tomatoes 94%</Caption>
            </CardFooter>
          </Card>
        </Section>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-gray-200 dark:border-gray-700 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            LettrSuggest Design System • Phase 2 Tasks 2.1-2.5
          </p>
        </div>
      </div>
    </div>
  );
}
