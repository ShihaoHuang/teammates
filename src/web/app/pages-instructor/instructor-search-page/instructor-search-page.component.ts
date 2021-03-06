import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, Observable, of } from 'rxjs';
import { finalize, map, mergeMap } from 'rxjs/operators';

import { InstructorSearchResult, SearchService } from '../../../services/search.service';
import { StatusMessageService } from '../../../services/status-message.service';
import {
  CommentSearchResult,
  InstructorPrivilege,
  Student,
} from '../../../types/api-output';
import { StudentListRowModel } from '../../components/student-list/student-list.component';
import { ErrorMessageOutput } from '../../error-message-output';
import { SearchCommentsTable } from './comment-result-table/comment-result-table.component';
import { SearchParams } from './instructor-search-bar/instructor-search-bar.component';
import { SearchStudentsListRowTable } from './student-result-table/student-result-table.component';

/**
 * Instructor search page.
 */
@Component({
  selector: 'tm-instructor-search-page',
  templateUrl: './instructor-search-page.component.html',
  styleUrls: ['./instructor-search-page.component.scss'],
})
export class InstructorSearchPageComponent implements OnInit {

  searchParams: SearchParams = {
    searchKey: '',
    isSearchForStudents: true,
    isSearchForComments: false,
  };
  studentsListRowTables: SearchStudentsListRowTable[] = [];
  commentTables: SearchCommentsTable[] = [];
  isSearching: boolean = false;

  constructor(
    private route: ActivatedRoute,
    private statusMessageService: StatusMessageService,
    private searchService: SearchService,
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe((queryParams: any) => {
      if (queryParams.studentSearchkey) {
        this.searchParams.searchKey = queryParams.studentSearchkey;
      }
      if (this.searchParams.searchKey) {
        this.search();
      }
    });
  }

  /**
   * Searches for students and questions/responses/comments matching the search query.
   */
  search(): void {
    if (!(this.searchParams.isSearchForComments || this.searchParams.isSearchForStudents)
        || this.searchParams.searchKey === '') {
      return;
    }
    this.isSearching = true;
    forkJoin([
      this.searchParams.isSearchForComments
          ? this.searchService.searchComment(this.searchParams.searchKey).pipe(
              map((resp: InstructorSearchResult) => {
                return {
                  searchCommentTables: this.getSearchCommentsTable(resp.comments),
                  searchStudentTables: [],
                };
              }),
          )
          : of({}) as Observable<TransformedInstructorSearchResult>,
      this.searchParams.isSearchForStudents
          ? this.searchService.searchInstructor(this.searchParams.searchKey).pipe(
            map((res: InstructorSearchResult) => this.getCoursesWithStudents(res.students)),
            mergeMap((coursesWithStudents: SearchStudentsListRowTable[]) =>
                forkJoin([
                  of(coursesWithStudents),
                  this.getPrivileges(coursesWithStudents),
                ]),
            ),
            map((res: [SearchStudentsListRowTable[], InstructorPrivilege[]]) => this.combinePrivileges(res)),
          )
          : of({}) as Observable<TransformedInstructorSearchResult>,
    ]).pipe(
        finalize(() => this.isSearching = false),
    ).subscribe((resp: TransformedInstructorSearchResult[]) => {
      this.commentTables = resp[0].searchCommentTables;
      const searchStudentsTable: SearchStudentsListRowTable[] = resp[1].searchStudentTables;
      const hasStudents: boolean = !!(
          searchStudentsTable && searchStudentsTable.length
      );
      const hasComments: boolean = !!(
          this.commentTables && this.commentTables.length
      );

      if (hasStudents) {
        this.studentsListRowTables = searchStudentsTable;
      }
      if (!hasStudents && !hasComments) {
        this.statusMessageService.showWarningToast('No results found.');
      }
    }, (resp: ErrorMessageOutput) => {
      this.statusMessageService.showErrorToast(resp.error.message);
    });
  }

  private getSearchCommentsTable(searchResults: CommentSearchResult[]): SearchCommentsTable[] {
    return searchResults.map((res: CommentSearchResult) => ({
      feedbackSession: res.feedbackSession,
      questions: res.questions,
    }));
  }

  getCoursesWithStudents(students: Student[]): SearchStudentsListRowTable[] {
    const distinctCourses: string[] = Array.from(
        new Set(students.map((s: Student) => s.courseId)),
    );
    const coursesWithStudents: SearchStudentsListRowTable[] = distinctCourses.map(
        (courseId: string) => ({
          courseId,
          students: Array.from(
              new Set(
                  students
                      .filter((s: Student) => s.courseId === courseId),
              ),
          ).map((s: Student) => ({
            student: s,
            isAllowedToViewStudentInSection: false,
            isAllowedToModifyStudent: false,
          })),
        }),
    );

    return coursesWithStudents;
  }

  getPrivileges(
      coursesWithStudents: SearchStudentsListRowTable[],
  ): Observable<InstructorPrivilege[]> {
    if (coursesWithStudents.length === 0) {
      return of([]);
    }
    const privileges: Observable<InstructorPrivilege>[] = [];
    coursesWithStudents.forEach((course: SearchStudentsListRowTable) => {
      const sectionToPrivileges: Record<string, Observable<InstructorPrivilege>> = {};
      Array.from(
          new Set(course.students.map((studentModel: StudentListRowModel) => studentModel.student.sectionName)),
      ).forEach((section: string) => {
        sectionToPrivileges[section] = this.searchService.searchInstructorPrivilege(course.courseId, section);
      });
      course.students.forEach((studentModel: StudentListRowModel) =>
          privileges.push(sectionToPrivileges[studentModel.student.sectionName]),
      );
    });
    return forkJoin(privileges);
  }

  combinePrivileges(
      [coursesWithStudents, privileges]: [SearchStudentsListRowTable[], InstructorPrivilege[]],
  ): TransformedInstructorSearchResult {
    /**
     * Pop the privilege objects one at a time and attach them to the results. This is possible
     * because `forkJoin` guarantees that the `InstructorPrivilege` results are returned in the
     * same order the requests were made.
     */
    for (const course of coursesWithStudents) {
      for (const studentModel of course.students) {
        const sectionPrivileges: InstructorPrivilege | undefined = privileges.shift();
        if (!sectionPrivileges) { continue; }

        studentModel.isAllowedToViewStudentInSection = sectionPrivileges.canViewStudentInSections;
        studentModel.isAllowedToModifyStudent = sectionPrivileges.canModifyStudent;
      }
    }

    return {
      searchStudentTables: coursesWithStudents,
      searchCommentTables: [],
    };
  }

}

interface TransformedInstructorSearchResult {
  searchCommentTables: SearchCommentsTable[];
  searchStudentTables: SearchStudentsListRowTable[];
}
