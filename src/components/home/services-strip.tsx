import { services } from "@/lib/catalog";

export function ServicesStrip() {
  return (
    <section aria-label="Services" className="border-t">
      <ul className="container-page grid gap-10 py-14 text-center sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
        {services.map((service) => (
          <li key={service.title}>
            <h3 className="label">{service.title}</h3>
            <p className="mt-2 text-sm text-muted">{service.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
