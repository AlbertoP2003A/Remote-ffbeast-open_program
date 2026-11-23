import React from "react";
import type { IconName } from "../components/Icons";
import { Card, EmptyState, PageHeader } from "../components/ui";

export function ComingSoon({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: IconName;
}): React.ReactElement {
  return (
    <>
      <PageHeader title={title} subtitle="Fase 2" />
      <Card>
        <EmptyState icon={icon} title="Disponible en la fase 2">
          {description}
        </EmptyState>
      </Card>
    </>
  );
}
