import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { ToastProvider } from './components/ToastProvider.jsx';
import { ConfirmProvider } from './components/ConfirmProvider.jsx';
import { SettingsProvider } from './components/SettingsProvider.jsx';
import { LeaveGuardProvider } from './components/LeaveGuardProvider.jsx';
import { Layout } from './components/Layout.jsx';
import { NotFound } from './screens/NotFound.jsx';
import { Settings } from './screens/Settings.jsx';
import { Trash } from './screens/Trash.jsx';
import { Today } from './screens/today/Today.jsx';
import { Search } from './screens/search/Search.jsx';
import { Library } from './screens/library/Library.jsx';
import { PlantPageRoute } from './screens/library/PlantPage.jsx';
import { PlantFormRoute } from './screens/library/PlantForm.jsx';
import { GuidePageRoute } from './screens/library/GuidePage.jsx';
import { GuideFormRoute } from './screens/library/GuideForm.jsx';
import { Places } from './screens/places/Places.jsx';
import { PlaceFormRoute } from './screens/places/PlaceForm.jsx';
import { PlacePageRoute } from './screens/places/PlacePage.jsx';
import { Spaces } from './screens/spaces/Spaces.jsx';
import { SpaceFormRoute } from './screens/spaces/SpaceForm.jsx';
import { SpacePageRoute } from './screens/spaces/SpacePage.jsx';
import { Plantings } from './screens/plantings/Plantings.jsx';
import { Calendar } from './screens/calendar/Calendar.jsx';
import { Supplies } from './screens/supplies/Supplies.jsx';
import { Microgreens } from './screens/microgreens/Microgreens.jsx';
import { TrayFormRoute } from './screens/microgreens/TrayForm.jsx';
import { TrayPageRoute } from './screens/microgreens/TrayPage.jsx';
import { Animals } from './screens/microgreens/Animals.jsx';
import { FoodForest } from './screens/foodforest/FoodForest.jsx';
import { Harvests } from './screens/harvests/Harvests.jsx';
import { Plan } from './screens/plan/Plan.jsx';
import { PlantingFormRoute } from './screens/plantings/PlantingForm.jsx';
import { PlantingPageRoute } from './screens/plantings/PlantingPage.jsx';

function Shell() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <ConfirmProvider>
          <LeaveGuardProvider>
            <Layout />
          </LeaveGuardProvider>
        </ConfirmProvider>
      </ToastProvider>
    </SettingsProvider>
  );
}

export const routes = [
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Today /> },
      { path: 'calendar', element: <Calendar /> },
      { path: 'supplies', element: <Supplies /> },
      { path: 'microgreens', element: <Microgreens /> },
      { path: 'food-forest', element: <FoodForest /> },
      { path: 'harvests', element: <Harvests /> },
      { path: 'plan', element: <Plan /> },
      { path: 'microgreens/animals', element: <Animals /> },
      { path: 'microgreens/trays/new', element: <TrayFormRoute /> },
      { path: 'microgreens/trays/:id', element: <TrayPageRoute /> },
      { path: 'microgreens/trays/:id/edit', element: <TrayFormRoute /> },
      { path: 'plantings', element: <Plantings /> },
      { path: 'plantings/new', element: <PlantingFormRoute /> },
      { path: 'plantings/:id', element: <PlantingPageRoute /> },
      { path: 'plantings/:id/edit', element: <PlantingFormRoute /> },
      { path: 'spaces', element: <Spaces /> },
      { path: 'spaces/new', element: <SpaceFormRoute /> },
      { path: 'spaces/:id', element: <SpacePageRoute /> },
      { path: 'spaces/:id/edit', element: <SpaceFormRoute /> },
      { path: 'places', element: <Places /> },
      { path: 'places/new', element: <PlaceFormRoute /> },
      { path: 'places/:id', element: <PlacePageRoute /> },
      { path: 'places/:id/edit', element: <PlaceFormRoute /> },
      { path: 'search', element: <Search /> },
      { path: 'library', element: <Library /> },
      { path: 'library/plants/new', element: <PlantFormRoute /> },
      { path: 'library/plants/:id', element: <PlantPageRoute /> },
      { path: 'library/plants/:id/edit', element: <PlantFormRoute /> },
      { path: 'library/guides/new', element: <GuideFormRoute /> },
      { path: 'library/guides/:id', element: <GuidePageRoute /> },
      { path: 'library/guides/:id/edit', element: <GuideFormRoute /> },
      { path: 'trash', element: <Trash /> },
      { path: 'settings', element: <Settings /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];

// createBrowserRouter inside App makes a new router per render. App renders once at the
// root, so that's fine. Don't put state above it.
export function App() {
  return <RouterProvider router={createBrowserRouter(routes)} />;
}
