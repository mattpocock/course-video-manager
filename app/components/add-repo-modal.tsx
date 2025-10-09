import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { useEffect } from "react";
import { useFetcher } from "react-router";

interface AddRepoModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddRepoModal({ isOpen, onOpenChange }: AddRepoModalProps) {
  const addRepoFetcher = useFetcher();

  useEffect(() => {
    if (addRepoFetcher.state === "idle" && addRepoFetcher.data) {
      onOpenChange(false);
    }
  }, [addRepoFetcher.state, addRepoFetcher.data, onOpenChange]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full bg-transparent">
          <Plus className="w-4 h-4 mr-2" />
          Add Repo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add New Repository</DialogTitle>
        </DialogHeader>
        <addRepoFetcher.Form
          method="post"
          action="/api/repos/add"
          className="space-y-4 py-4"
        >
          <div className="space-y-2">
            <Label htmlFor="repo-name">Repository Name</Label>
            <Input
              id="repo-name"
              placeholder="e.g., Total TypeScript"
              name="name"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="repo-path">Repository File Path</Label>
            <Input
              id="repo-path"
              placeholder="Enter local file path..."
              name="repoPath"
              required
            />
          </div>
          <div className="flex justify-end space-x-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              Cancel
            </Button>
            <Button type="submit">Add Repository</Button>
          </div>
        </addRepoFetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
