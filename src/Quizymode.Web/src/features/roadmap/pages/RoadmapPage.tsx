import { Link } from "react-router-dom";
import { SEO } from "@/components/SEO";
import { ArrowRightIcon } from "@heroicons/react/24/outline";

const RoadmapPage = () => {
  return (
    <>
      <SEO
        title="Quizymode Roadmap"
        description="Upcoming features and improvements planned for Quizymode. Priorities may change as the product evolves and as user feedback comes in."
        canonical="https://www.quizymode.com/roadmap"
      />
      <div className="bg-surface rounded-lg shadow-sm px-4 py-8 sm:px-6 lg:px-8 max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-6">Quizymode Roadmap</h1>
        
        <div className="prose prose-lg max-w-none mb-8">
          <p className="text-lg text-gray-700 leading-relaxed mb-8">
            This page outlines upcoming features and improvements planned for Quizymode.
          </p>
          
          <p className="text-lg text-gray-700 leading-relaxed mb-8">
            Priorities may change as the product evolves and as user feedback comes in.
          </p>
        </div>

        <div className="space-y-8 mb-8">
          {/* In Progress */}
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">🚧 In Progress</h2>
            <ul className="space-y-3 text-gray-700">
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Improved quiz navigation and session flow</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Better performance and loading times</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>UI refinements for mobile and tablet users</span>
              </li>
            </ul>
          </div>

          {/* Planned */}
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">🔜 Planned</h2>
            <ul className="space-y-3 text-gray-700">
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>User accounts with saved progress</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Personal dictionaries and custom collections</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Enhanced search and filtering for quiz content</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Accessibility improvements</span>
              </li>
            </ul>
          </div>

          {/* Under Consideration */}
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">💡 Under Consideration</h2>
            <ul className="space-y-3 text-gray-700">
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Text-to-speech learning mode</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Spaced repetition options</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Community-shared quiz sets</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Import/export of quizzes</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-8 mt-8">
          <p className="text-lg text-gray-700 mb-4">
            Have an idea that would make Quizymode better?
          </p>
          <Link
            to="/feedback"
            className="inline-flex items-center gap-2 text-indigo-ink hover:text-indigo-ink font-semibold transition-colors text-lg"
          >
            👉 Submit feedback here
            <ArrowRightIcon className="h-5 w-5" />
          </Link>
        </div>
      </div>
    </>
  );
};

export default RoadmapPage;
