import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex justify-center flex-col gap-4 items-center p-4 min-h-[calc(100vh-128px)]">
      <h1 className="text-center text-4xl">404</h1>
      <p className="text-center text-xl">
        The page you&apos;re looking for doesn&apos;t exist
      </p>
      <Button asChild>
        <Link href={{ pathname: "/" }}>Take Me Back</Link>
      </Button>
    </main>
  );
}
