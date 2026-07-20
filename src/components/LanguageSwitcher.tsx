import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card px-2 py-1">
      <Globe className="h-4 w-4 text-muted-foreground" />

      <Button
        variant={language === "lt" ? "default" : "ghost"}
        size="sm"
        onClick={() => setLanguage("lt")}
        className="h-8 px-3"
      >
        🇱🇹 LT
      </Button>

      <Button
        variant={language === "en" ? "default" : "ghost"}
        size="sm"
        onClick={() => setLanguage("en")}
        className="h-8 px-3"
      >
        🇬🇧 ENG
      </Button>
    </div>
  );
}
