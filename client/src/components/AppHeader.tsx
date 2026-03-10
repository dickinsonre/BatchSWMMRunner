import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Activity, CheckCircle2, Monitor } from "lucide-react";
import { SiGithub } from "react-icons/si";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import ThemeToggle from "@/components/ThemeToggle";
import type { SwmmStatus } from "@shared/schema";

const navItems = [
  { label: "Batch Processing", href: "/" },
  { label: "Folder View", href: "/folder" },
  { label: "ReSWMM", href: "/reswmm" },
  { label: "Docs", href: "/docs" },
];

interface AppHeaderProps {
  swmmStatus?: SwmmStatus | null;
}

export default function AppHeader({ swmmStatus: externalSwmmStatus }: AppHeaderProps) {
  const [location] = useLocation();
  const [swmmStatus, setSwmmStatus] = useState<SwmmStatus | null>(externalSwmmStatus ?? null);

  useEffect(() => {
    if (externalSwmmStatus !== undefined) {
      setSwmmStatus(externalSwmmStatus);
      return;
    }
    fetch('/api/swmm-status')
      .then(res => res.json())
      .then((data: SwmmStatus) => setSwmmStatus(data))
      .catch(err => console.error('Failed to fetch SWMM status:', err));
  }, [externalSwmmStatus]);

  return (
    <header className="border-b">
      <div className="container max-w-6xl mx-auto px-8 py-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/">
              <div className="rounded-lg bg-primary p-2 cursor-pointer">
                <Activity className="h-6 w-6 text-primary-foreground" data-testid="icon-app-logo" />
              </div>
            </Link>
            <div>
              <h1 className="text-2xl font-semibold" data-testid="text-app-title">BatchSWMM</h1>
              <p className="text-sm text-muted-foreground" data-testid="text-app-subtitle">
                Batch EPA SWMM5 Processing Tool
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {swmmStatus && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Badge
                      variant={swmmStatus.found ? 'default' : 'secondary'}
                      data-testid="badge-swmm-mode"
                    >
                      {swmmStatus.found ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          SWMM5 Ready
                        </>
                      ) : (
                        <>
                          <Monitor className="h-3 w-3 mr-1" />
                          Simulation Mode
                        </>
                      )}
                    </Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="font-medium">EPA SWMM 5.2.4 Native Engine</p>
                  <p className="text-xs text-muted-foreground">
                    {swmmStatus.found
                      ? `Compiled C binary at: ${swmmStatus.path}`
                      : 'No engine detected — using simulated results'}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
            {navItems.map((item) => {
              const isActive = location === item.href;
              return isActive ? (
                <Badge
                  key={item.href}
                  variant="default"
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}-active`}
                >
                  {item.label}
                </Badge>
              ) : (
                <Link key={item.href} href={item.href} data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}>
                  <Badge variant="outline" className="cursor-pointer">
                    {item.label}
                  </Badge>
                </Link>
              );
            })}
            <a
              href="https://github.com/SWMMEnablement"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center h-9 w-9 rounded-md hover-elevate"
              data-testid="link-github"
            >
              <SiGithub className="h-4 w-4" />
            </a>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
