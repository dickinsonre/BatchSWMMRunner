import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "@/pages/Home";
import ElevatorPitch from "@/pages/ElevatorPitch";
import Dashboard from "@/pages/Dashboard";
import Documentation from "@/pages/Documentation";
import FolderView from "@/pages/FolderView";
import ReswmmPage from "@/pages/ReswmmPage";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/pitch" component={ElevatorPitch} />
      <Route path="/folder" component={FolderView} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/docs" component={Documentation} />
      <Route path="/reswmm" component={ReswmmPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
