import "../docs.css";
import type { Metadata } from "next";
import { HowItWorks } from "@/components/docs/HowItWorks";

export const metadata: Metadata = {
  title: "How it works — Clippy.fun",
  description: "How Clippy, an AI agent, trades one red paperclip up to $100,000: the loop, the rules it can't break, and its public wallet.",
};

export default function Docs() {
  return <HowItWorks />;
}
