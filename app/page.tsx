import dynamic from "next/dynamic";

const HarborJelly = dynamic(() => import("@/components/HarborJelly"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col items-center justify-center w-full h-full bg-[#081224] text-cyan-400 font-mono text-sm gap-3">
      <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      <span>Loading Pantalan 3D Diorama • Engineered by Dylan Ramos...</span>
    </div>
  ),
});

export default function Home() {
  return (
    <main className="relative w-screen h-screen overflow-hidden bg-[#070e1b]">
      <HarborJelly />
    </main>
  );
}
