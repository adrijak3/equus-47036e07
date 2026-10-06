import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CalendarDays, FolderOpen, Image as ImageIcon, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface GalleryFolder {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface GalleryPhoto {
  id: string;
  folder_id: string;
  storage_path: string;
  public_url: string;
  original_name: string | null;
  created_at: string;
}

const formatUpdated = (date: string) =>
  new Date(date).toLocaleDateString("lt-LT", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const extensionFor = (file: File) => {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext && /^[a-z0-9]+$/.test(ext)) return ext;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
};

export default function Galerija() {
  const { isAdmin } = useAuth();
  const [folders, setFolders] = useState<GalleryFolder[]>([]);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<GalleryPhoto | null>(null);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderDescription, setNewFolderDescription] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);

  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = async () => {
    setLoading(true);

    const [folderResult, photoResult] = await Promise.all([
      supabase.from("gallery_folders").select("*").order("updated_at", { ascending: false }),
      supabase.from("gallery_photos").select("*").order("created_at", { ascending: false }),
    ]);

    if (folderResult.error) {
      toast.error("Nepavyko įkelti galerijos: " + folderResult.error.message);
      setFolders([]);
    } else {
      setFolders((folderResult.data ?? []) as GalleryFolder[]);
    }

    if (photoResult.error) {
      toast.error("Nepavyko įkelti nuotraukų: " + photoResult.error.message);
      setPhotos([]);
    } else {
      setPhotos((photoResult.data ?? []) as GalleryPhoto[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const photosByFolder = useMemo(() => {
    const map = new Map<string, GalleryPhoto[]>();
    for (const photo of photos) {
      const list = map.get(photo.folder_id) ?? [];
      list.push(photo);
      map.set(photo.folder_id, list);
    }
    return map;
  }, [photos]);

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const selectedPhotos = selectedFolderId ? photosByFolder.get(selectedFolderId) ?? [] : [];

  useEffect(() => {
    if (selectedFolderId && !folders.some((folder) => folder.id === selectedFolderId)) {
      setSelectedFolderId(null);
    }
  }, [folders, selectedFolderId]);

  const createFolder = async () => {
    const name = newFolderName.trim();

    if (!name) {
      toast.error("Įrašykite aplanko pavadinimą.");
      return;
    }

    setSavingFolder(true);
    const { data, error } = await supabase
      .from("gallery_folders")
      .insert({
        name,
        description: newFolderDescription.trim() || null,
      })
      .select("*")
      .single();
    setSavingFolder(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setFolders((current) => [data as GalleryFolder, ...current]);
    setNewFolderName("");
    setNewFolderDescription("");
    setNewFolderOpen(false);
    toast.success("Galerijos aplankas sukurtas.");
  };

  const startEditFolder = (folder: GalleryFolder) => {
    setEditingFolder(folder.id);
    setEditName(folder.name);
    setEditDescription(folder.description ?? "");
  };

  const saveEditFolder = async () => {
    if (!editingFolder || !editName.trim()) {
      toast.error("Aplanko pavadinimas negali būti tuščias.");
      return;
    }

    const updatedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("gallery_folders")
      .update({
        name: editName.trim(),
        description: editDescription.trim() || null,
        updated_at: updatedAt,
      })
      .eq("id", editingFolder)
      .select("*")
      .single();

    if (error) {
      toast.error(error.message);
      return;
    }

    setFolders((current) =>
      current
        .map((folder) => (folder.id === editingFolder ? (data as GalleryFolder) : folder))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    );
    setEditingFolder(null);
    toast.success("Aplankas atnaujintas.");
  };

  const deletePhoto = async (photo: GalleryPhoto) => {
    if (!confirm("Ištrinti šią nuotrauką iš galerijos?")) return;

    const { error: storageError } = await supabase.storage.from("gallery").remove([photo.storage_path]);
    if (storageError) {
      toast.error("Nepavyko ištrinti failo: " + storageError.message);
      return;
    }

    const { error } = await supabase.from("gallery_photos").delete().eq("id", photo.id);
    if (error) {
      toast.error(error.message);
      return;
    }

    const updatedAt = new Date().toISOString();
    await supabase.from("gallery_folders").update({ updated_at: updatedAt }).eq("id", photo.folder_id);

    setPhotos((current) => current.filter((item) => item.id !== photo.id));
    setFolders((current) =>
      current
        .map((folder) => (folder.id === photo.folder_id ? { ...folder, updated_at: updatedAt } : folder))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    );

    if (lightboxPhoto?.id === photo.id) setLightboxPhoto(null);
    toast.success("Nuotrauka ištrinta.");
  };

  const deleteFolder = async (folder: GalleryFolder) => {
    const folderPhotos = photosByFolder.get(folder.id) ?? [];
    const message =
      "Ištrinti aplanką „" +
      folder.name +
      "“ ir visas " +
      folderPhotos.length +
      " jame esančias nuotraukas?";

    if (!confirm(message)) return;

    if (folderPhotos.length > 0) {
      const { error: storageError } = await supabase.storage
        .from("gallery")
        .remove(folderPhotos.map((photo) => photo.storage_path));
      if (storageError) {
        toast.error("Nepavyko ištrinti nuotraukų: " + storageError.message);
        return;
      }
    }

    const { error } = await supabase.from("gallery_folders").delete().eq("id", folder.id);
    if (error) {
      toast.error(error.message);
      return;
    }

    setFolders((current) => current.filter((item) => item.id !== folder.id));
    setPhotos((current) => current.filter((item) => item.folder_id !== folder.id));
    if (selectedFolderId === folder.id) setSelectedFolderId(null);
    toast.success("Aplankas ištrintas.");
  };

  const uploadPhotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (!selectedFolder || files.length === 0) return;

    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length !== files.length) {
      toast.error("Kai kurie pasirinkti failai nėra nuotraukos.");
    }
    if (imageFiles.length === 0) return;

    setUploading(true);
    let uploadedCount = 0;
    const addedPhotos: GalleryPhoto[] = [];

    for (const file of imageFiles) {
      if (file.size > 15 * 1024 * 1024) {
        toast.error("„" + file.name + "“ yra didesnė nei 15 MB ir praleista.");
        continue;
      }

      const path = selectedFolder.id + "/" + crypto.randomUUID() + "." + extensionFor(file);

      const { error: uploadError } = await supabase.storage.from("gallery").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type,
      });

      if (uploadError) {
        toast.error("Nepavyko įkelti „" + file.name + "“: " + uploadError.message);
        continue;
      }

      const { data: publicData } = supabase.storage.from("gallery").getPublicUrl(path);

      const { data, error: insertError } = await supabase
        .from("gallery_photos")
        .insert({
          folder_id: selectedFolder.id,
          storage_path: path,
          public_url: publicData.publicUrl,
          original_name: file.name,
        })
        .select("*")
        .single();

      if (insertError) {
        await supabase.storage.from("gallery").remove([path]);
        toast.error("Nepavyko išsaugoti „" + file.name + "“: " + insertError.message);
        continue;
      }

      addedPhotos.push(data as GalleryPhoto);
      uploadedCount += 1;
    }

    const updatedAt = new Date().toISOString();

    if (uploadedCount > 0) {
      await supabase.from("gallery_folders").update({ updated_at: updatedAt }).eq("id", selectedFolder.id);

      setPhotos((current) => [...addedPhotos, ...current]);
      setFolders((current) =>
        current
          .map((folder) => (folder.id === selectedFolder.id ? { ...folder, updated_at: updatedAt } : folder))
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      );

      toast.success(uploadedCount === 1 ? "Nuotrauka įkelta." : "Įkeltos " + uploadedCount + " nuotraukos.");
    }

    setUploading(false);
  };

  return (
    <div className="container max-w-7xl py-10 md:py-14">
      {!selectedFolder ? (
        <>
          <header className="mb-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.25em] text-gold/70">Equus jojimo mokykla</p>
              <h1 className="text-4xl font-display text-gradient-gold md:text-5xl">Galerija</h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground md:text-base">
                Equus nuotraukų galerija - kviečiame pasižvalgyti!
              </p>
            </div>

            {isAdmin && (
              <Button variant="gold" onClick={() => setNewFolderOpen((value) => !value)}>
                <Plus className="h-4 w-4" />
                Naujas aplankas
              </Button>
            )}
          </header>

          {isAdmin && newFolderOpen && (
            <section className="mb-8 rounded-2xl border border-gold/20 bg-gradient-card p-5 shadow-elegant md:p-6">
              <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <label className="space-y-2">
                  <span className="text-sm font-medium">Aplanko pavadinimas</span>
                  <input
                    value={newFolderName}
                    onChange={(event) => setNewFolderName(event.target.value)}
                    placeholder="Pvz. Varžybos 2026"
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-gold"
                  />
                </label>

                <label className="space-y-2">
                  <span className="text-sm font-medium">Trumpas aprašymas</span>
                  <input
                    value={newFolderDescription}
                    onChange={(event) => setNewFolderDescription(event.target.value)}
                    placeholder="Pvz. Rudens varžybų akimirkos"
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-gold"
                  />
                </label>

                <div className="flex gap-2">
                  <Button variant="gold" onClick={createFolder} disabled={savingFolder}>
                    {savingFolder ? "Kuriama…" : "Sukurti"}
                  </Button>
                  <Button variant="ghost" onClick={() => setNewFolderOpen(false)}>
                    Atšaukti
                  </Button>
                </div>
              </div>
            </section>
          )}

          {loading ? (
            <div className="py-20 text-center text-muted-foreground">Kraunama galerija…</div>
          ) : folders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gold/20 bg-gradient-card px-6 py-20 text-center">
              <FolderOpen className="mx-auto mb-4 h-10 w-10 text-gold/60" />
              <h2 className="font-display text-2xl text-gold">Galerija dar tuščia</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {isAdmin ? "Sukurkite pirmą aplanką ir įkelkite nuotraukas." : "Nuotraukos čia atsiras netrukus:)."}
              </p>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {folders.map((folder) => {
                const folderPhotos = photosByFolder.get(folder.id) ?? [];
                const preview = folderPhotos[0];

                return (
                  <article
                    key={folder.id}
                    className="group overflow-hidden rounded-2xl border border-gold/15 bg-gradient-card shadow-elegant transition-all duration-300 hover:-translate-y-1 hover:border-gold/30"
                  >
                    <button type="button" onClick={() => setSelectedFolderId(folder.id)} className="block w-full text-left">
                      <div className="relative aspect-[4/3] overflow-hidden bg-background/40">
                        {preview ? (
                          <img
                            src={preview.public_url}
                            alt={folder.name}
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <FolderOpen className="h-14 w-14 text-gold/35" />
                          </div>
                        )}

                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

                        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 text-xs text-white">
                          <span className="rounded-full border border-white/20 bg-black/25 px-2.5 py-1 backdrop-blur-sm">
                            {folderPhotos.length} {folderPhotos.length === 1 ? "nuotrauka" : "nuotraukos"}
                          </span>
                          <span className="rounded-full border border-white/20 bg-black/25 px-2.5 py-1 backdrop-blur-sm">
                            {formatUpdated(folder.updated_at)}
                          </span>
                        </div>
                      </div>

                      <div className="p-4">
                        <h2 className="font-display text-xl text-gold">{folder.name}</h2>
                        {folder.description && (
                          <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{folder.description}</p>
                        )}
                        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CalendarDays className="h-3.5 w-3.5" />
                          Atnaujinta {formatUpdated(folder.updated_at)}
                        </div>
                      </div>
                    </button>

                    {isAdmin && (
                      <div className="flex items-center justify-end gap-1 border-t border-gold/10 px-3 py-2">
                        <Button variant="ghost" size="sm" onClick={() => startEditFolder(folder)}>
                          <Pencil className="h-3.5 w-3.5" />
                          Redaguoti
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => void deleteFolder(folder)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {isAdmin && editingFolder && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-md">
              <div className="w-full max-w-lg rounded-2xl border border-gold/20 bg-gradient-card p-6 shadow-elegant">
                <div className="mb-5 flex items-center justify-between">
                  <h2 className="font-display text-2xl text-gradient-gold">Redaguoti aplanką</h2>
                  <button
                    type="button"
                    onClick={() => setEditingFolder(null)}
                    className="rounded-md p-2 text-muted-foreground hover:text-gold"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Pavadinimas</span>
                    <input
                      value={editName}
                      onChange={(event) => setEditName(event.target.value)}
                      className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-gold"
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Aprašymas</span>
                    <textarea
                      value={editDescription}
                      onChange={(event) => setEditDescription(event.target.value)}
                      rows={4}
                      className="flex w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-gold"
                    />
                  </label>

                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setEditingFolder(null)}>
                      Atšaukti
                    </Button>
                    <Button variant="gold" onClick={() => void saveEditFolder()}>
                      Išsaugoti
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <button
                type="button"
                onClick={() => setSelectedFolderId(null)}
                className="mb-4 flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-gold"
              >
                <ArrowLeft className="h-4 w-4" />
                Į galeriją
              </button>

              <h1 className="text-4xl font-display text-gradient-gold">{selectedFolder.name}</h1>
              {selectedFolder.description && (
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground md:text-base">{selectedFolder.description}</p>
              )}
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <CalendarDays className="h-3.5 w-3.5" />
                Atnaujinta {formatUpdated(selectedFolder.updated_at)}
              </div>
            </div>

            {isAdmin && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={uploadPhotos}
                />
                <Button variant="gold" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  <Upload className="h-4 w-4" />
                  {uploading ? "Keliama…" : "Pridėti nuotraukas"}
                </Button>
              </div>
            )}
          </div>

          {selectedPhotos.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gold/20 bg-gradient-card px-6 py-20 text-center">
              <ImageIcon className="mx-auto mb-4 h-10 w-10 text-gold/60" />
              <h2 className="font-display text-2xl text-gold">Aplankas dar tuščias</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {isAdmin ? "Pridėkite pirmąsias nuotraukas." : "Šiame aplanke nuotraukų dar nėra."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
              {selectedPhotos.map((photo) => (
                <article
                  key={photo.id}
                  className="group relative aspect-square overflow-hidden rounded-xl border border-gold/10 bg-background/30"
                >
                  <button type="button" onClick={() => setLightboxPhoto(photo)} className="h-full w-full">
                    <img
                      src={photo.public_url}
                      alt={photo.original_name ?? selectedFolder.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </button>

                  {isAdmin && (
                    <button
                      type="button"
                      aria-label="Ištrinti nuotrauką"
                      onClick={() => void deletePhoto(photo)}
                      className={cn(
                        "absolute right-2 top-2 flex h-9 w-9 items-center justify-center",
                        "rounded-full border border-white/15 bg-black/50 text-white backdrop-blur-sm",
                        "opacity-100 transition-colors hover:bg-destructive",
                        "sm:opacity-0 sm:group-hover:opacity-100",
                      )}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-3 backdrop-blur-sm md:p-8"
          onClick={() => setLightboxPhoto(null)}
        >
          <button
            type="button"
            aria-label="Uždaryti nuotrauką"
            onClick={() => setLightboxPhoto(null)}
            className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxPhoto.public_url}
            alt={lightboxPhoto.original_name ?? selectedFolder?.name ?? "Equus galerija"}
            className="max-h-[92vh] max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
