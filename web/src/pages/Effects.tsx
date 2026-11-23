import React from "react";
import { GroupFields } from "../components/GroupFields";
import { AdvancedSection } from "../components/controls";
import { Banner, Card, PageHeader } from "../components/ui";

export function Effects(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Efectos"
        subtitle="Fuerzas, amortiguación y recorrido del volante."
      />

      <Banner tone="info" icon="check" title="Aplicación inmediata">
        Cada cambio se escribe en el volante y se verifica con lectura de vuelta.
      </Banner>

      <Card title="Básicos" subtitle="Lo que se toca a diario.">
        <GroupFields group="effects" />
      </Card>

      <Card>
        <AdvancedSection hint="dirección y fuerza DirectX">
          <GroupFields group="effects" onlyAdvanced />
        </AdvancedSection>
      </Card>
    </>
  );
}
