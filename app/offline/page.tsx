export default function Offline() {
  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center gap-3 px-4 py-10">
      <h1 className="text-xl font-semibold">Sin señal</h1>
      <p className="text-tenue">
        Esta pantalla no estaba guardada en el celular. Las visitas que registres se guardan y se suben solas cuando vuelva la señal.
      </p>
      <a href="/hoy" className="font-medium text-marca underline">Volver a la ruta de hoy</a>
    </main>
  )
}
