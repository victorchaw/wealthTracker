import { Navigate } from "react-router-dom";
import { useProfile } from "@/hooks/useProfile";
import Dashboard from "./Dashboard";

const Index = () => {
  const { data: profile, isLoading } = useProfile();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }
  if (profile && !profile.onboarded) {
    return <Navigate to="/onboarding" replace />;
  }
  return <Dashboard />;
};

export default Index;
